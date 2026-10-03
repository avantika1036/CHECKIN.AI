"""Demo data: two organisations that use the SAME code with DIFFERENT configs.

Run:  python -m app.seed
"""
from psycopg.types.json import Jsonb

from .config_schema import TenantConfig
from .db import make_pool, migrate
from .security import hash_password
from .settings import get_settings

UIET = {
    "display_name": "UIET, Panjab University", "timezone": "Asia/Kolkata", "host_label": "Person to meet",
    "required_fields": ["name", "phone", "host", "purpose"], "autoclose_time": "18:30",
    "rules": [
        {"id": "phone_format", "type": "regex", "field": "phone", "pattern": r"\+91[6-9]\d{9}",
         "severity": "block", "message": "Phone number is not a valid Indian mobile number"},
        {"id": "host_exists", "type": "host_must_exist", "severity": "block",
         "message": "Person to meet was not found, or several people match - pick one from the list"},
        {"id": "blacklist", "type": "blacklist", "severity": "block", "message": "Visitor is on the blacklist"},
        {"id": "office_hours", "type": "time_window", "start": "08:00", "end": "18:00",
         "severity": "needs_approval", "message": "Outside visiting hours (08:00-18:00): admin approval needed"},
        {"id": "press_vendor", "type": "purpose_triggers", "keywords": ["press", "media", "vendor", "sales"],
         "severity": "needs_approval", "message": "Press / vendor / sales visits need admin approval"},
        {"id": "name_has_digits", "type": "regex", "field": "name", "pattern": r"\D{2,}",
         "severity": "warn", "message": "Name contains digits - please check"},
    ],
}
GREENVIEW = {
    "display_name": "Greenview Residents' Society", "timezone": "Asia/Kolkata", "host_label": "Resident / flat",
    "required_fields": ["name", "host", "purpose"], "autoclose_time": "23:30",   # phone optional here
    "rules": [
        {"id": "phone_format", "type": "regex", "field": "phone", "pattern": r"\+91[6-9]\d{9}",
         "severity": "block", "message": "Phone number is not a valid Indian mobile number"},
        {"id": "host_exists", "type": "host_must_exist", "severity": "block",
         "message": "Resident / flat not found, or several match - pick one from the list"},
        {"id": "blacklist", "type": "blacklist", "severity": "block", "message": "Visitor is not allowed in"},
        {"id": "late_visit", "type": "time_window", "start": "06:00", "end": "22:00",
         "severity": "needs_approval", "message": "After 22:00 the resident must approve this visit"},
        {"id": "no_soliciting", "type": "purpose_triggers", "keywords": ["salesman", "marketing", "promotion"],
         "severity": "block", "message": "Soliciting is not allowed in the society"},
    ],
}
HOSTS = {
    "uiet": [("Dr. Naveen Aggarwal", ["aggarwal sir", "naveen sir"], "CSE", "naveen@example.edu"),
             ("Dr. Rajesh Aggarwal", ["rajesh sir"], "ECE", "rajesh@example.edu"),
             ("Prof. Sunita Verma", ["verma madam"], "Admissions", "sunita@example.edu"),
             ("Mr. Harpreet Singh", ["harpreet"], "Accounts", "harpreet@example.edu")],
    "greenview": [("Mr. Sandeep Kapoor", ["a 101", "flat a 101", "kapoor ji"], "Tower A", "a101@example.org"),
                  ("Mrs. Meera Nair", ["b 204", "flat b 204", "nair madam"], "Tower B", "b204@example.org")],
}
BLACKLIST = {"uiet": [("+919000000001", "Banned: repeated trespassing")],
             "greenview": [("+919000000002", "Banned: harassment complaint")]}


def seed(pool) -> None:
    pw = hash_password(get_settings().seed_password)
    with pool.connection() as conn:
        for tid, cfg in (("uiet", UIET), ("greenview", GREENVIEW)):
            TenantConfig.model_validate(cfg)                       # fail loudly if a config is wrong
            conn.execute("INSERT INTO tenants (id, name, config) VALUES (%s,%s,%s) "
                         "ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, name = EXCLUDED.name",
                         (tid, cfg["display_name"], Jsonb(cfg)))
            for role in ("guard", "admin"):
                conn.execute("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (%s,%s,%s,%s) "
                             "ON CONFLICT (username) DO NOTHING", (tid, f"{role}_{tid}", pw, role))
            if not conn.execute("SELECT 1 FROM hosts WHERE tenant_id = %s", (tid,)).fetchone():
                for name, aliases, dept, email in HOSTS[tid]:
                    conn.execute("INSERT INTO hosts (tenant_id, name, aliases, department, email) "
                                 "VALUES (%s,%s,%s,%s,%s)", (tid, name, aliases, dept, email))
            for phone, reason in BLACKLIST[tid]:
                conn.execute("INSERT INTO blacklist (tenant_id, phone, reason) VALUES (%s,%s,%s) "
                             "ON CONFLICT DO NOTHING", (tid, phone, reason))


if __name__ == "__main__":
    p = make_pool()
    p.open()
    print("migrations applied:", migrate(p))
    seed(p)
    print("seeded tenants: uiet, greenview  (users: guard_uiet, admin_uiet, guard_greenview, admin_greenview)")
    p.close()
