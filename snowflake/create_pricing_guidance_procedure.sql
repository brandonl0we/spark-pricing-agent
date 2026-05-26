-- Run this inside the target Snowflake account with a role that can:
-- - create procedures in AC.SANDBOX
-- - read AC.SANDBOX.PROENTERPRISEDATA
-- - read AC.SANDBOX.STARTERPLUSDATA
-- - use the warehouse that will execute the procedure
--
-- Zapier/Spark call shape:
-- CALL AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(
--   PARSE_JSON('{"planTier":"enterprise","region":"NORTHAM","productLine":"ac","listPrice":4700,"contactLimit":600000,"termLength":12}')
-- );

CREATE OR REPLACE PROCEDURE AC.SANDBOX.CALCULATE_PRICING_GUIDANCE(INPUT VARIANT)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'pandas', 'numpy', 'statsmodels')
HANDLER = 'calculate_pricing_guidance'
AS
$$
import json
import time
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm

warnings.filterwarnings("ignore")


def _as_dict(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return dict(value)


def _first_present(payload, *names):
    for name in names:
        if name in payload and payload[name] not in ("", None):
            return payload[name]
    return None


def _to_float(value):
    if value in ("", None):
        return None
    if isinstance(value, str):
        value = value.replace("$", "").replace(",", "").strip()
    try:
        return float(value)
    except Exception:
        return None


def _to_int_flag(value):
    if value in ("", None):
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value != 0)
    return 1 if str(value).strip().lower() in ("1", "true", "yes", "y") else 0


def _clean_text(value):
    if value in ("", None):
        return None
    return str(value).strip()


def _load_training_data(session):
    pro_ent = session.sql("""
        SELECT
            AccountID                        AS account_id,
            PlanTier                         AS plan_tier,
            Region                           AS region,
            ProductLine                      AS product_line,
            RSID                             AS reseller_id,
            ContactLimit                     AS contact_limit,
            ListPrice                        AS list_price,
            DiscountRate                     AS discount_rate,
            SMS                              AS sms_flag,
            SMSCredits                       AS sms_credits,
            Whatsapp                         AS whatsapp,
            Term                             AS term_length,
            ARR                              AS arr,
            PriceRealization                 AS price_realization
        FROM AC.SANDBOX.PROENTERPRISEDATA
        WHERE PriceRealization IS NOT NULL
    """).to_pandas()

    starter_plus = session.sql("""
        SELECT
            AccountID                        AS account_id,
            PlanTier                         AS plan_tier,
            Region                           AS region,
            ProductLine                      AS product_line,
            RSID                             AS reseller_id,
            ContactLimit                     AS contact_limit,
            ListPrice                        AS list_price,
            DiscountRate                     AS discount_rate,
            SMSFlag                          AS sms_flag,
            SMSCredits                       AS sms_credits,
            WhatsApp                         AS whatsapp,
            Term                             AS term_length,
            ARR                              AS arr,
            PR                               AS price_realization
        FROM AC.SANDBOX.STARTERPLUSDATA
        WHERE PR IS NOT NULL
    """).to_pandas()

    df = pd.concat([pro_ent, starter_plus], ignore_index=True)
    df.columns = [c.upper() for c in df.columns]
    return df


def _prepare_training_data(df):
    for col in ["LIST_PRICE", "ARR"]:
        df[col] = (
            df[col]
            .astype(str)
            .str.replace("$", "", regex=False)
            .str.replace(",", "", regex=False)
            .str.strip()
        )
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["CONTACT_LIMIT"] = (
        df["CONTACT_LIMIT"]
        .astype(str)
        .str.replace(",", "", regex=False)
        .str.strip()
    )
    df["CONTACT_LIMIT"] = pd.to_numeric(df["CONTACT_LIMIT"], errors="coerce").fillna(0)

    for col in ["PRICE_REALIZATION", "DISCOUNT_RATE", "TERM_LENGTH"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["PLAN_TIER"] = df["PLAN_TIER"].fillna("").astype(str).str.strip().str.lower()
    df["REGION"] = df["REGION"].fillna("").astype(str).str.strip().str.upper()
    df["PRODUCT_LINE"] = df["PRODUCT_LINE"].fillna("").astype(str).str.strip().str.lower()

    df["has_reseller"] = (
        pd.to_numeric(df["RESELLER_ID"], errors="coerce").fillna(0) != 0
    ).astype(int)
    df["has_sms"] = pd.to_numeric(df["SMS_FLAG"], errors="coerce").fillna(0).astype(int)
    df["has_whatsapp"] = df["WHATSAPP"].fillna("").astype(str).str.strip().ne("").astype(int)

    df["log_list_price"] = np.log1p(df["LIST_PRICE"])
    df["log_contact_limit"] = np.log1p(df["CONTACT_LIMIT"])
    df["log_arr"] = np.log1p(df["ARR"])
    return df


def _train_models(df):
    cat_cols = ["PLAN_TIER", "REGION", "PRODUCT_LINE"]
    df_encoded = pd.get_dummies(df, columns=cat_cols, drop_first=True, dtype=int)

    features = (
        [
            "log_list_price",
            "log_contact_limit",
            "TERM_LENGTH",
            "has_reseller",
            "has_sms",
            "has_whatsapp",
        ]
        + [c for c in df_encoded.columns if c.startswith("PLAN_TIER_")]
        + [c for c in df_encoded.columns if c.startswith("REGION_")]
        + [c for c in df_encoded.columns if c.startswith("PRODUCT_LINE_")]
    )
    features = [f for f in features if f in df_encoded.columns]

    x_raw = df_encoded[features]
    x = sm.add_constant(x_raw, has_constant="add")
    y = df_encoded["PRICE_REALIZATION"].clip(0, 1)

    quantiles = {
        "p50": 0.50,
        "p75": 0.75,
        "p95": 0.95,
    }

    models = {}
    for label, q in quantiles.items():
        result = sm.QuantReg(y, x).fit(q=q, max_iter=2000)
        models[label] = result

    defaults = {
        "list_price": float(df["LIST_PRICE"].median()),
        "contact_limit": float(df["CONTACT_LIMIT"].median()),
        "term_length": float(df["TERM_LENGTH"].median()),
    }

    return models, features, defaults


def _predict(payload, models, features, defaults):
    plan_tier = _clean_text(_first_present(payload, "planTier", "plan_tier"))
    region = _clean_text(_first_present(payload, "region"))
    product_line = _clean_text(_first_present(payload, "productLine", "product_line"))

    list_price = _to_float(_first_present(payload, "listPrice", "list_price"))
    contact_limit = _to_float(_first_present(payload, "contactLimit", "contact_limit"))
    term_length = _to_float(_first_present(payload, "termLength", "term_length", "term"))

    list_price = list_price if list_price is not None else defaults["list_price"]
    contact_limit = contact_limit if contact_limit is not None else defaults["contact_limit"]
    term_length = term_length if term_length is not None else defaults["term_length"]

    has_sms = _to_int_flag(_first_present(payload, "smsFlag", "sms_flag", "sms"))
    has_whatsapp = _to_int_flag(_first_present(payload, "whatsapp"))
    has_reseller = _to_int_flag(_first_present(payload, "resellerId", "reseller_id", "rsid"))

    plan_tier_key = plan_tier.lower() if plan_tier else None
    region_key = region.upper() if region else None
    product_line_key = product_line.lower() if product_line else None

    row = {
        "log_list_price": np.log1p(list_price),
        "log_contact_limit": np.log1p(contact_limit),
        "TERM_LENGTH": term_length,
        "has_reseller": has_reseller,
        "has_sms": has_sms,
        "has_whatsapp": has_whatsapp,
    }

    for col in [c for c in features if c.startswith("PLAN_TIER_")]:
        row[col] = 1 if plan_tier_key and col == f"PLAN_TIER_{plan_tier_key}" else 0

    for col in [c for c in features if c.startswith("REGION_")]:
        row[col] = 1 if region_key and col == f"REGION_{region_key}" else 0

    for col in [c for c in features if c.startswith("PRODUCT_LINE_")]:
        row[col] = 1 if product_line_key and col == f"PRODUCT_LINE_{product_line_key}" else 0

    input_df = pd.DataFrame([row]).reindex(columns=features, fill_value=0)
    x_input = sm.add_constant(input_df, has_constant="add")

    predictions = {}
    for label, result in models.items():
        value = float(result.predict(x_input)[0])
        predictions[label] = round(float(np.clip(value, 0.0, 1.0)), 4)

    return predictions, {
        "planTier": plan_tier,
        "region": region,
        "productLine": product_line,
        "listPrice": list_price,
        "contactLimit": contact_limit,
        "termLength": term_length,
        "hasSms": has_sms,
        "hasWhatsapp": has_whatsapp,
        "hasReseller": has_reseller,
    }


def _discount_from_realization(realization):
    return round(max(0.0, min(100.0, (1.0 - realization) * 100.0)), 2)


def calculate_pricing_guidance(session, input):
    started = time.time()
    payload = _as_dict(input)

    df = _prepare_training_data(_load_training_data(session))
    models, features, defaults = _train_models(df)
    predictions, normalized_input = _predict(payload, models, features, defaults)

    p50 = predictions["p50"]
    p75 = predictions["p75"]
    p95 = predictions["p95"]

    list_price = normalized_input["listPrice"] or _to_float(_first_present(payload, "arr")) or 0
    recommended_discount = _discount_from_realization(p75)
    max_discount = _discount_from_realization(p50)
    best_case_discount = _discount_from_realization(p95)

    recommended_price = round(float(list_price) * p75, 2)
    floor_price = round(float(list_price) * p50, 2)

    return {
        "quoteId": f"Q-SF-{int(time.time())}",
        "recommendedDiscount": recommended_discount,
        "maxDiscount": max(max_discount, recommended_discount),
        "floorPrice": floor_price,
        "recommendedPrice": recommended_price,
        "approvalRequired": False,
        "approvalLevel": "None",
        "reasonCodes": [
            f"p50 realization: {p50}",
            f"p75 realization: {p75}",
            f"p95 realization: {p95}",
            f"best-case discount: {best_case_discount}%",
        ],
        "modelVersion": "snowflake-quantreg-v1",
        "provider": "snowflake",
        "calculatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "debug": {
            "normalizedInput": normalized_input,
            "runtimeSeconds": round(time.time() - started, 2),
        },
    }
$$;
