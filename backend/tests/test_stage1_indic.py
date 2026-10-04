import pytest

from app.indic import name_sound_similarity as sim
from app.indic import skeleton_tokens
from app.textnorm import norm_text


def test_normalisation_keeps_hindi_and_punjabi_words_whole():
    """Regression: vowel signs are combining marks; an early version split 'राहुल' into pieces."""
    assert norm_text("राहुल शर्मा, ९८७६") == "राहुल शर्मा ९८७६"
    assert norm_text("ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ") == "ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ"


@pytest.mark.parametrize("a,b,c", [
    ("Rahul Sharma", "राहुल शर्मा", "ਰਾਹੁਲ ਸ਼ਰਮਾ"),
    ("Gurpreet Singh", "गुरप्रीत सिंह", "ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ"),
    ("Simran Kaur", "सिमरन कौर", "ਸਿਮਰਨ ਕੌਰ"),
    ("Naveen Aggarwal", "नवीन अग्रवाल", "ਨਵੀਨ ਅਗਰਵਾਲ"),
    ("Manpreet Gill", "मनप्रीत गिल", "ਮਨਪ੍ਰੀਤ ਗਿੱਲ"),
    ("Anjali Thakur", "अंजलि ठाकुर", "ਅੰਜਲੀ ਠਾਕੁਰ"),
])
def test_the_same_name_in_three_scripts_sounds_the_same(a, b, c):
    assert sim(a, b) == sim(a, c) == sim(b, c) == 1.0


@pytest.mark.parametrize("a,b", [
    ("Rahul Sharma", "Rohit Kumar"), ("Amit Kumar", "Ankit Kumar"), ("Gurpreet Singh", "Harpreet Singh"),
    ("Simran", "Simrat"), ("राहुल शर्मा", "Rohit Kumar"), ("ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ", "Harpreet Singh"),
])
def test_different_names_do_not_sound_the_same(a, b):
    assert sim(a, b) < 0.9


def test_spelling_variants_of_one_name_still_match():
    for a, b in [("Agrawal", "Aggarwal"), ("Navin", "Naveen"), ("Sharma", "Sarma"), ("Suneeta", "Sunita")]:
        assert sim(a, b) == 1.0


def test_digits_and_flat_numbers():
    assert skeleton_tokens("A-101") == ["101"] and skeleton_tokens("a101") == ["101"]
    assert skeleton_tokens("Dr. Aggarwal sir") == ["grvl"]


def test_known_limit_vowel_only_differences_are_invisible():
    """Honest limit: consonant skeletons ignore vowels, so Rahul/Rohul look identical."""
    assert sim("Rahul", "Rohul") == 1.0
