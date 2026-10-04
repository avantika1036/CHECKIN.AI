import pytest
from pydantic import ValidationError

from app.config_schema import TenantConfig
from app.main import AnswerIn, RunIn
from app.security import create_token, decode_token, hash_password, verify_password
from app.seed import UIET
from app.textnorm import find_phones, normalize_phone


def test_autoclose_time_is_validated_like_other_time_config():
    assert TenantConfig.model_validate({**UIET, "autoclose_time": "23:30"}).autoclose_time == "23:30"
    with pytest.raises(ValidationError):
        TenantConfig.model_validate({**UIET, "autoclose_time": "9pm"})


@pytest.mark.parametrize("payload", [
    {"text": "   "},
    {"fields": {}},
    {},
])
def test_run_input_rejects_empty_requests(payload):
    with pytest.raises(ValidationError):
        RunIn.model_validate(payload)


def test_run_input_accepts_text_or_form_fields():
    assert RunIn(text="  visitor arrived  ").text == "  visitor arrived  "
    assert RunIn(fields={"name": "Asha"}).fields == {"name": "Asha"}


def test_answer_input_rejects_unknown_actions():
    with pytest.raises(ValidationError):
        AnswerIn(action="execute")


def test_passwords_and_tokens_round_trip():
    password = "correct horse battery staple"
    encoded = hash_password(password)
    assert verify_password(password, encoded)
    assert not verify_password("wrong", encoded)

    token = create_token("guard_uiet", "uiet", "guard")
    claims = decode_token(token)
    assert claims["sub"] == "guard_uiet"
    assert claims["tenant"] == "uiet"
    assert claims["role"] == "guard"


def test_phone_normalization_supports_indic_digits_and_formats():
    assert normalize_phone("९८७६५ ४३२१०") == "+919876543210"
    assert normalize_phone("+91-98765-43210") == "+919876543210"
    assert find_phones("Call 98765 43210 or 91234 56789") == [
        "+919876543210",
        "+919123456789",
    ]


def test_expired_tokens_are_rejected(monkeypatch):
    from app import security

    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: type(
            "Settings",
            (),
            {"jwt_secret": "test-secret-test-secret-test-secret", "jwt_ttl_minutes": -1},
        )(),
    )
    token = security.create_token("guard_uiet", "uiet", "guard")
    with pytest.raises(security.jwt.ExpiredSignatureError):
        security.decode_token(token)
