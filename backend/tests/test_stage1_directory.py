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


def test_known_limitations_are_honest(seeded):
    """Documented weaknesses of trigram matching (a phonetic matcher is a possible upgrade)."""
    with seeded.connection() as c:
        assert directory.resolve_host(c, "uiet", "Dr Agrawal").status == "not_found"   # spelling variant
        assert directory.resolve_host(c, "greenview", "a101").status == "ambiguous"    # unspaced flat id


def test_hosts_of_other_tenants_are_invisible(seeded):
    with seeded.connection() as c:
        assert directory.resolve_host(c, "greenview", "Naveen Aggarwal").status == "not_found"


def test_blacklist_lookup(seeded):
    with seeded.connection() as c:
        assert "trespassing" in directory.blacklist_reason(c, "uiet", "+919000000001")
        assert directory.blacklist_reason(c, "uiet", "+919876543210") is None
        assert directory.blacklist_reason(c, "greenview", "+919000000001") is None   # other tenant's list
