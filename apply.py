"""
apply.py — Semi-automatic job application filler using Playwright.

SETUP (one-time):
  pip install playwright
  playwright install chromium

  Put your resume PDFs in the resumes/ folder:
    resumes/SDE_Resume.pdf
    resumes/Frontend_Resume.pdf
    etc.

USAGE:
  python apply.py

WHAT IT DOES:
  1. Asks which resume to use
  2. Asks for the job application URL
  3. Opens a browser (you can see everything)
  4. Auto-fills all standard fields it can find
  5. Pauses — you review, answer custom questions, click Submit
  6. Asks if you submitted → logs to your tracker automatically
"""

import json
import time
import requests
from pathlib import Path

# ── Load profile ──────────────────────────────────────────────
PROFILE_FILE = Path(__file__).parent / "profile.json"
RESUMES_DIR  = Path(__file__).parent / "resumes"
TRACKER_URL  = "http://localhost:3000"

with open(PROFILE_FILE) as f:
    P = json.load(f)


# ── Field fill helpers ────────────────────────────────────────

def try_fill(page, selectors: list, value: str):
    """Try a list of selectors, fill the first one that exists and is visible."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() > 0 and el.is_visible():
                el.fill(str(value))
                return True
        except Exception:
            pass
    return False


def try_select(page, selectors: list, value: str):
    """Try to select an option in a dropdown."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() > 0 and el.is_visible():
                el.select_option(label=value)
                return True
        except Exception:
            pass
    return False


def try_check(page, selectors: list):
    """Try to check a checkbox or radio."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() > 0 and el.is_visible():
                if not el.is_checked():
                    el.check()
                return True
        except Exception:
            pass
    return False


def upload_resume(page, resume_path: str):
    """Upload resume to any file input on the page."""
    try:
        file_input = page.locator("input[type='file']").first
        if file_input.count() > 0:
            file_input.set_input_files(resume_path)
            print("  ✓ Resume uploaded")
            return True
    except Exception as e:
        print(f"  ! Could not upload resume automatically: {e}")
    return False


# ── Main field filling ────────────────────────────────────────

def detect_ats(url: str) -> str:
    if "lever.co" in url:      return "lever"
    if "greenhouse.io" in url: return "greenhouse"
    if "workday.com" in url or "myworkdayjobs.com" in url: return "workday"
    return "generic"


def fill_lever(page, resume_path: str):
    """Fill Lever ATS specific fields."""
    print("\n  Detected: Lever ATS")
    time.sleep(2)

    # Full name
    try_fill(page, ["input[name='name']", "input[placeholder*='Full name']"], P["full_name"])
    # Email
    try_fill(page, ["input[name='email']", "input[type='email']"], P["email"])
    # Phone
    try_fill(page, ["input[name='phone']", "input[type='tel']"], P["phone_formatted"])
    # Location
    try_fill(page, ["input[name='location']", "input[placeholder*='location']",
                    "input[placeholder*='Location']", "input[placeholder*='City']"], P["city"] + ", " + P["state_abbr"])
    # LinkedIn (Lever stores as urls[LinkedIn])
    try_fill(page, ["input[name='urls[LinkedIn]']", "input[placeholder*='LinkedIn']"], P["linkedin"])
    # GitHub
    try_fill(page, ["input[name='urls[GitHub]']", "input[placeholder*='GitHub']"], P["github"])
    # Portfolio
    try_fill(page, ["input[name='urls[Portfolio]']", "input[placeholder*='Portfolio']"], P["github"])
    # Other
    try_fill(page, ["input[name='urls[Other]']"], P["github"])

    # Custom card fields — look for label text and fill nearby input
    _fill_lever_card(page, "Street Address", P["address_line1"])
    _fill_lever_card(page, "zip code", P["zip"])
    _fill_lever_card(page, "Preferred Name", P["first_name"])

    # Selects — authorization
    _select_lever_card(page, "legally authorized", "Yes")
    # Sponsorship
    _select_lever_card(page, "sponsorship", "Yes")
    # Worked at company before
    _select_lever_card(page, "ever worked at", "No")
    # Attending Life.Church
    _select_lever_card(page, "attending", "No")
    # Referred by staff
    _radio_lever_card(page, "referred by a staff", "No")
    # Family member on staff
    _radio_lever_card(page, "family member", "No")
    # Relocation limitations
    _select_lever_card(page, "relocation", "No")

    # Acknowledgment selects — look for "I agree" or "Yes, I agree"
    _select_lever_card(page, "acknowledgment", "I agree")
    _select_lever_card(page, "equal opportunity", "I agree")
    _select_lever_card(page, "religious", "I agree")
    _select_lever_card(page, "committed to partner", "I agree")

    # EEO gender
    _radio_lever_card(page, "Gender", "Female")

    # Upload resume
    time.sleep(1)
    upload_resume(page, resume_path)
    print("  ✓ Lever fields filled — fill custom questions manually")


def _fill_lever_card(page, label_text: str, value: str):
    """Find a Lever card by its label text and fill the input inside it."""
    try:
        # Find label containing the text, then find sibling/child input
        locator = page.locator(f"text=/{label_text}/i").first
        if locator.count() > 0:
            parent = locator.locator("xpath=ancestor::div[contains(@class,'application-field') or contains(@class,'field')][1]")
            inp = parent.locator("input, textarea").first
            if inp.count() > 0 and inp.is_visible():
                inp.fill(value)
    except Exception:
        pass


def _select_lever_card(page, label_text: str, value: str):
    """Find a Lever card by label and select an option."""
    try:
        locator = page.locator(f"text=/{label_text}/i").first
        if locator.count() > 0:
            parent = locator.locator("xpath=ancestor::div[contains(@class,'application-field') or contains(@class,'field')][1]")
            sel = parent.locator("select").first
            if sel.count() > 0 and sel.is_visible():
                # Try to find matching option
                options = sel.locator("option").all_text_contents()
                match = next((o for o in options if value.lower() in o.lower()), None)
                if match:
                    sel.select_option(label=match)
    except Exception:
        pass


def _radio_lever_card(page, label_text: str, value: str):
    """Find radio buttons near a label and click the matching one."""
    try:
        locator = page.locator(f"text=/{label_text}/i").first
        if locator.count() > 0:
            parent = locator.locator("xpath=ancestor::div[contains(@class,'application-field') or contains(@class,'field')][1]")
            radios = parent.locator(f"text={value}").first
            if radios.count() > 0:
                radios.click()
    except Exception:
        pass


def fill_greenhouse(page, resume_path: str):
    """Fill Greenhouse ATS specific fields."""
    print("\n  Detected: Greenhouse ATS")
    time.sleep(2)
    try_fill(page, ["#first_name", "input[name='job_application[first_name]']"], P["first_name"])
    try_fill(page, ["#last_name",  "input[name='job_application[last_name]']"],  P["last_name"])
    try_fill(page, ["#email",      "input[name='job_application[email]']"],       P["email"])
    try_fill(page, ["#phone",      "input[name='job_application[phone]']"],       P["phone_formatted"])
    try_fill(page, ["input[name='job_application[location]']", "input[id*='location']"], P["city"] + ", " + P["state_abbr"])
    # LinkedIn / website fields
    page.locator("input[placeholder*='LinkedIn']").first.fill(P["linkedin"]) if page.locator("input[placeholder*='LinkedIn']").count() > 0 else None
    page.locator("input[placeholder*='GitHub']").first.fill(P["github"])     if page.locator("input[placeholder*='GitHub']").count() > 0 else None
    time.sleep(1)
    upload_resume(page, resume_path)
    print("  ✓ Greenhouse fields filled")


def fill_standard_fields(page, resume_path: str):
    """Fill all standard application fields using the profile."""
    print("\n  Filling standard fields...")

    # First name
    try_fill(page, [
        "input[name*='first'][type='text']",
        "input[placeholder*='First']",
        "input[id*='first']",
        "input[aria-label*='First name']",
        "#first_name", "#firstName", "[name='first_name']",
    ], P["first_name"])

    # Last name
    try_fill(page, [
        "input[name*='last'][type='text']",
        "input[placeholder*='Last']",
        "input[id*='last']",
        "input[aria-label*='Last name']",
        "#last_name", "#lastName", "[name='last_name']",
    ], P["last_name"])

    # Full name (some forms use one field)
    try_fill(page, [
        "input[placeholder*='Full name']",
        "input[placeholder*='full name']",
        "input[aria-label*='Full name']",
        "#full_name", "[name='full_name']",
    ], P["full_name"])

    # Email
    try_fill(page, [
        "input[type='email']",
        "input[name*='email']",
        "input[placeholder*='Email']",
        "input[id*='email']", "#email",
    ], P["email"])

    # Phone
    try_fill(page, [
        "input[type='tel']",
        "input[name*='phone']",
        "input[placeholder*='Phone']",
        "input[id*='phone']", "#phone",
    ], P["phone_formatted"])

    # LinkedIn
    try_fill(page, [
        "input[placeholder*='LinkedIn']",
        "input[name*='linkedin']",
        "input[id*='linkedin']",
        "input[aria-label*='LinkedIn']",
    ], P["linkedin"])

    # GitHub / website / portfolio
    try_fill(page, [
        "input[placeholder*='GitHub']",
        "input[name*='github']",
        "input[placeholder*='Website']",
        "input[placeholder*='Portfolio']",
        "input[name*='website']",
        "input[id*='github']",
    ], P["github"])

    # Address
    try_fill(page, [
        "input[placeholder*='Address']",
        "input[name*='address']",
        "input[id*='address']",
        "#address", "[name='address_line1']",
    ], P["address_line1"])

    # City
    try_fill(page, [
        "input[placeholder*='City']",
        "input[name*='city']",
        "input[id*='city']", "#city",
    ], P["city"])

    # State
    try_fill(page, [
        "input[placeholder*='State']",
        "input[name*='state']",
        "input[id*='state']",
    ], P["state"])
    try_select(page, [
        "select[name*='state']",
        "select[id*='state']",
        "#state",
    ], P["state"])

    # Zip
    try_fill(page, [
        "input[placeholder*='Zip']",
        "input[placeholder*='Postal']",
        "input[name*='zip']",
        "input[name*='postal']",
        "#zip", "#postal_code",
    ], P["zip"])

    # Work authorization
    if P["authorized_to_work"]:
        try_check(page, [
            "input[type='radio'][value*='yes'][name*='authorized']",
            "input[type='radio'][value*='Yes'][name*='authorized']",
            "input[type='radio'][value*='authorized']",
        ])

    # Sponsorship
    sponsorship_val = "Yes" if P["require_sponsorship"] else "No"
    try_check(page, [
        f"input[type='radio'][value*='{sponsorship_val}'][name*='sponsor']",
    ])

    # How did you hear
    try_select(page, [
        "select[name*='source']",
        "select[name*='heard']",
        "select[id*='source']",
        "select[id*='heard']",
    ], P["how_heard"])
    try_fill(page, [
        "input[placeholder*='How did you hear']",
        "input[name*='how_heard']",
    ], P["how_heard"])

    # Gender
    try_select(page, [
        "select[name*='gender']",
        "select[id*='gender']",
    ], P["gender"])

    # Veteran
    try_check(page, [
        "input[type='radio'][value*='not'][name*='veteran']",
        "input[type='radio'][value*='No'][name*='veteran']",
    ])

    # Disability
    try_check(page, [
        "input[type='radio'][value*='No'][name*='disability']",
        "input[type='radio'][value*='no'][name*='disability']",
        "input[type='radio'][value*='no disability']",
    ])

    # Upload resume
    time.sleep(1)
    upload_resume(page, resume_path)

    print("  ✓ Standard fields filled — review the form above")


# ── Tracker integration ───────────────────────────────────────

def tracker_login():
    resp = requests.post(
        f"{TRACKER_URL}/api/auth/login",
        data={"username": P["email"], "password": "Mahathi@123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    if resp.status_code == 200:
        return resp.json()["access_token"]
    return None


def log_to_tracker(company: str, role: str, url: str):
    token = tracker_login()
    if not token:
        print("  ! Could not log to tracker (is Docker running?)")
        return
    today = __import__("datetime").date.today().isoformat()
    resp = requests.post(
        f"{TRACKER_URL}/api/jobs",
        json={"company": company, "role": role, "status": "applied",
              "applied_date": today, "notes": f"Applied via auto-fill script\nURL: {url}"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code in (200, 201):
        print(f"  ✓ Logged to tracker: {company} — {role}")
    else:
        print(f"  ! Tracker log failed: {resp.status_code}")


# ── Resume picker ─────────────────────────────────────────────

def pick_resume() -> str:
    pdfs = sorted(RESUMES_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"\nNo PDFs found in {RESUMES_DIR}")
        print("Add your resume PDFs to the resumes/ folder and try again.")
        raise SystemExit(1)

    print("\n┌─────────────────────────────────────┐")
    print("│         Which resume to use?         │")
    print("├─────────────────────────────────────┤")
    for i, pdf in enumerate(pdfs, 1):
        print(f"│  {i}. {pdf.name:<33}│")
    print("└─────────────────────────────────────┘")

    while True:
        choice = input(f"Enter number (1–{len(pdfs)}): ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(pdfs):
            return str(pdfs[int(choice) - 1])
        print("Invalid choice, try again.")


# ── Main ──────────────────────────────────────────────────────

def main():
    from playwright.sync_api import sync_playwright

    print("=" * 45)
    print("  Job Application Auto-Fill")
    print("=" * 45)

    resume_path = pick_resume()
    print(f"\nUsing: {Path(resume_path).name}")

    url = input("\nPaste the job application URL: ").strip()
    if not url.startswith("http"):
        print("Invalid URL.")
        return

    company = input("Company name: ").strip()
    role    = input("Role / Job title: ").strip()

    print(f"\nOpening {url} ...")
    print("The browser will open. Review the form and submit when ready.")
    print("Press ENTER here after you submit (or type 'skip' to skip logging).\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=200)
        page    = browser.new_page()

        page.goto(url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        time.sleep(2)

        ats = detect_ats(url)
        if ats == "lever":
            fill_lever(page, resume_path)
        elif ats == "greenhouse":
            fill_greenhouse(page, resume_path)
        else:
            fill_standard_fields(page, resume_path)

        print("\n" + "─" * 45)
        print("  BROWSER IS READY — review the form above")
        print("  Fill in any custom questions manually")
        print("  Then click Submit in the browser")
        print("─" * 45)

        action = input("\nPress ENTER after submitting (or type 'skip'): ").strip()

        if action.lower() != "skip":
            log_to_tracker(company, role, url)

        print("\nDone! Browser will close in 5 seconds...")
        time.sleep(5)
        browser.close()


if __name__ == "__main__":
    main()
