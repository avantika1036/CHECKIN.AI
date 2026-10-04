import pytest

from app import directory


@pytest.mark.parametrize("tenant,spoken,status,name_part", [
    ("uiet", "Naveen Aggarwal", "resolved", "Naveen"),
    ("uiet", "naveen", "resolved", "Naveen"),
    ("uiet", "Prof Sunita", "resolved", "Sunita"),
    ("uiet", "Verma madam", "resolved", "Verma"),
    ("uiet", "Singh", "resolved", "Harpreet"),
    ("uiet", "Dr Aggarwal", "ambiguous", None),         # two Aggarwals -> must ask, never guess
    ("uiet", "nobody here", "not_found", None),
    ("uiet", "", "missing", None),
    ("greenview", "flat A-101", "resolved", "Kapoor"),  # alias match: flats work like names
    ("greenview", "Kapoor ji", "resolved", "Kapoor"),
    ("greenview", "B 204", "resolved", "Meera"),
])
def test_host_resolution(seeded, tenant, spoken, status, name_part):
    with seeded.connection() as c:
        r = directory.resolve_host(c, tenant, spoken)
    assert r.status == status
    if name_part:
        assert name_part in r.chosen["name"]


@pytest.mark.parametrize("tenant,spoken,status,name_part", [
    ("uiet", "Dr Agrawal", "ambiguous", None),            # spelling variant: now finds BOTH Aggarwals (was: not found)
    ("uiet", "Naveen Agrawal", "resolved", "Naveen"),
    ("uiet", "नवीन अग्रवाल", "resolved", "Naveen"),         # Hindi
    ("uiet", "ਨਵੀਨ ਅਗਰਵਾਲ", "resolved", "Naveen"),          # Punjabi
    ("uiet", "प्रोफेसर सुनीता वर्मा जी", "resolved", "Sunita"),  # Hindi with title and 'ji'
    ("uiet", "ਹਰਪ੍ਰੀਤ ਸਿੰਘ", "resolved", "Harpreet"),
    ("uiet", "अग्रवाल सर", "ambiguous", None),             # two Aggarwals, in Hindi too
    ("greenview", "a101", "resolved", "Kapoor"),           # unspaced flat id (was: ambiguous)
    ("greenview", "फ्लैट B 204", "resolved", "Meera"),
])
def test_host_resolution_by_sound_across_scripts(seeded, tenant, spoken, status, name_part):
    with seeded.connection() as c:
        r = directory.resolve_host(c, tenant, spoken)
    assert r.status == status
    if name_part:
        assert name_part in r.chosen["name"]


def test_similar_sounding_person_is_offered_but_never_picked_silently(seeded):
    """Gurpreet Singh is a visitor, Harpreet Singh is staff: similar, different people."""
    with seeded.connection() as c:
        r = directory.resolve_host(c, "uiet", "Gurpreet Singh")
    assert r.status == "ambiguous" and r.chosen is None
    assert any("Harpreet" in x["name"] for x in r.candidates)        # still offered in the list


def test_remaining_limits_are_stated_honestly(seeded):
    """Sound matching ignores vowels, so two staff whose names differ ONLY in vowels cannot be told apart;
    the lookup then reports 'ambiguous' and the guard picks. It must never silently pick one."""
    with seeded.connection() as c:
        c.execute("INSERT INTO hosts (tenant_id, name) VALUES ('uiet', 'Dr. Rohul Mehra')")
        c.execute("INSERT INTO hosts (tenant_id, name) VALUES ('uiet', 'Dr. Rahul Mehra')")
        assert directory.resolve_host(c, "uiet", "Rahul Mehra").status == "ambiguous"


def test_hosts_of_other_tenants_are_invisible(seeded):
    with seeded.connection() as c:
        assert directory.resolve_host(c, "greenview", "Naveen Aggarwal").status == "not_found"


def test_blacklist_lookup(seeded):
    with seeded.connection() as c:
        assert "trespassing" in directory.blacklist_reason(c, "uiet", "+919000000001")
        assert directory.blacklist_reason(c, "uiet", "+919876543210") is None
        assert directory.blacklist_reason(c, "greenview", "+919000000001") is None   # other tenant's list
