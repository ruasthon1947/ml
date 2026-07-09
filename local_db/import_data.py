"""Sync Consolidated_Cases.csv into the configured Google Sheets master tab.

Credential options, in order:
1. GOOGLE_SHEETS_WEBHOOK_URL
   A custom endpoint that accepts JSON: spreadsheetId, gid, values.
2. GOOGLE_SERVICE_ACCOUNT_JSON
   Either a JSON string or a path to a service-account JSON file.
3. GOOGLE_APPLICATION_CREDENTIALS
   Path to a service-account JSON file.
4. local_db/service_account.json

For service accounts, share the target Google Sheet with the service account
email before running this script.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
CSV_PATH = Path(os.getenv("CONSOLIDATED_CASES_CSV", ROOT / "Consolidated_Cases.csv"))
SPREADSHEET_ID = os.getenv(
    "GOOGLE_SHEET_ID",
    "1sExCOOVJDT6J68DM93E_QPbZGs_-RzPOlfXACYd8mS4",
)
SHEET_GID = int(os.getenv("GOOGLE_SHEET_GID", "2122513566"))
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def read_values() -> list[list[str]]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"CSV file not found: {CSV_PATH}")

    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        return [row for row in csv.reader(handle)]


def post_webhook(values: list[list[str]]) -> None:
    webhook = os.getenv("GOOGLE_SHEETS_WEBHOOK_URL")
    if not webhook:
        return

    payload = json.dumps(
        {
            "spreadsheetId": SPREADSHEET_ID,
            "gid": SHEET_GID,
            "values": values,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        webhook,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            raise RuntimeError(f"Webhook sync failed: HTTP {response.status} {body}")
    print(f"Synced {len(values) - 1} rows through GOOGLE_SHEETS_WEBHOOK_URL.")


def load_service_account_info() -> dict[str, Any]:
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        if raw.startswith("{"):
            return json.loads(raw)
        path = Path(raw)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        raise FileNotFoundError(f"GOOGLE_SERVICE_ACCOUNT_JSON path does not exist: {path}")

    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if credentials_path:
        path = Path(credentials_path)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        raise FileNotFoundError(f"GOOGLE_APPLICATION_CREDENTIALS path does not exist: {path}")

    local_path = ROOT / "service_account.json"
    if local_path.exists():
        return json.loads(local_path.read_text(encoding="utf-8"))

    raise RuntimeError(
        "Google Sheets credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, "
        "GOOGLE_APPLICATION_CREDENTIALS, place service_account.json in local_db, or set "
        "GOOGLE_SHEETS_WEBHOOK_URL."
    )


def service_account_token() -> str:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError as exc:
        raise RuntimeError(
            "Missing Google auth libraries. Install google-auth and requests in the Python "
            "environment that runs local_db/import_data.py."
        ) from exc

    credentials = service_account.Credentials.from_service_account_info(
        load_service_account_info(),
        scopes=SCOPES,
    )
    credentials.refresh(Request())
    if not credentials.token:
        raise RuntimeError("Google auth succeeded but no access token was returned.")
    return credentials.token


def google_request(method: str, url: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Google Sheets API failed: HTTP {exc.code} {body}") from exc


def quoted_range(value: str) -> str:
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def resolve_sheet_title(token: str) -> str:
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}"
        "?fields=sheets(properties(sheetId,title))"
    )
    metadata = google_request("GET", url, token)
    for sheet in metadata.get("sheets", []):
        properties = sheet.get("properties", {})
        if int(properties.get("sheetId", -1)) == SHEET_GID:
            return str(properties["title"])
    raise RuntimeError(f"No sheet tab with gid {SHEET_GID} was found in spreadsheet {SPREADSHEET_ID}.")


def sync_with_service_account(values: list[list[str]]) -> None:
    token = service_account_token()
    sheet_title = resolve_sheet_title(token)
    sheet_range = urllib.parse.quote(quoted_range(sheet_title), safe="")
    start_range = urllib.parse.quote(f"{quoted_range(sheet_title)}!A1", safe="")

    clear_url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}"
        f"/values/{sheet_range}:clear"
    )
    google_request("POST", clear_url, token, {})

    update_url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}"
        f"/values/{start_range}?valueInputOption=RAW"
    )
    google_request("PUT", update_url, token, {"majorDimension": "ROWS", "values": values})
    print(f"Synced {len(values) - 1} rows to Google Sheets tab '{sheet_title}'.")


def main() -> int:
    values = read_values()
    if not values:
        raise RuntimeError("Consolidated_Cases.csv has no rows to sync.")

    if os.getenv("GOOGLE_SHEETS_WEBHOOK_URL"):
        post_webhook(values)
    else:
        sync_with_service_account(values)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"import_data.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
