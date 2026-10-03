from app.textnorm import find_phones, norm_text, normalize_phone, script_of, strip_titles, to_ascii_digits


def test_phone_formats_all_normalise_to_e164():
    for raw in ["9876543210", "98765 43210", "+91-98765-43210", "09876543210", "919876543210"]:
        assert normalize_phone(raw) == "+919876543210"


def test_phone_in_hindi_and_punjabi_digits():
    assert normalize_phone("९८७६५४३२१०") == "+919876543210"      # Devanagari
    assert normalize_phone("੯੮੭੬੫੪੩੨੧੦") == "+919876543210"      # Gurmukhi
    assert to_ascii_digits("१२३") == "123"


def test_invalid_phones_rejected():
    for raw in ["12345", "5876543210", "98765432", None, "", "abcdefghij"]:
        assert normalize_phone(raw) is None


def test_find_phones_in_a_sentence():
    assert find_phones("Rahul here, call 98765 43210 or +91 91234-56789 ok") == ["+919876543210", "+919123456789"]
    assert find_phones("no number here, room 204") == []


def test_script_detection():
    assert script_of("Rahul Sharma") == "latin"
    assert script_of("राहुल शर्मा") == "devanagari"
    assert script_of("ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ") == "gurmukhi"
    assert script_of("Rahul राहुल") == "mixed"
    assert script_of("1234") == "none"


def test_titles_stripped_for_matching():
    assert strip_titles("Dr. Aggarwal sir") == "aggarwal"
    assert strip_titles("Prof Sunita Verma madam") == "sunita verma"
    assert norm_text("  A-101,  Flat!! ") == "a 101 flat"
