"""Parser tests for a Revival remodeling proposal."""
import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from proposal_ingest import ProposalParseError, parse_proposal


def _docx(paragraphs: list[str]) -> bytes:
    body = []
    for line in paragraphs:
        text = (
            line.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        body.append(f"<w:p><w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>")
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(body)}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


SAMPLE = [
    "Revised Remodeling Proposal",
    "Client: Dino & Vickie",
    "Project Address: 511 Dunaway St., Lexington, Kentucky",
    "Date: July 22, 2026",
    "Project Summary",
    "The remaining balance due to Revival Home Remodeling is $49,400.00.",
    "Contract Price and Remaining Balance",
    "Budget Category",
    "Amount",
    "Original quoted contract price",
    "$60,000.00",
    "Less HVAC provided and installed by homeowners",
    "($10,000.00)",
    "Less paint purchased by homeowners",
    "($600.00)",
    "REMAINING CONTRACT BALANCE",
    "$49,400.00",
    "Detailed Scope of Work",
    "Kitchen",
    "Install black shaker-style cabinetry.",
    "Bathroom",
    "Bathroom remodel scope remains included.",
    "Itemized Materials & Allowances",
    "Material / Allowance",
    "Amount",
    "Black shaker-style kitchen cabinets",
    "$6,200.00",
    "HVAC system — homeowners provide and install ($10,000.00 value, not billed)",
    "$0.00",
    "Dumpster, disposal, and miscellaneous",
    "$4,090.00",
    "TOTAL MATERIALS & EQUIPMENT (contractor-furnished)",
    "$10,290.00",
    "Payment Schedule",
    "$24,000.00 deposit is due up front.",
    "$12,700.00 is due when demolition is complete and materials are on the ground.",
    "$12,700.00 is due upon completion and final walkthrough.",
    "Terms, Notes & Disclaimer",
    "$24,000.00 deposit is due up front.",
    "Estimated project duration is approximately 10-14 working days, subject to weather.",
    "Homeowners will provide and install the HVAC system themselves.",
    "Acceptance",
]


def test_parse_sample_proposal_balances():
    parsed = parse_proposal(_docx(SAMPLE))
    assert parsed["client_name"] == "Dino & Vickie"
    assert parsed["project_address"].startswith("511 Dunaway")
    assert parsed["proposal_date"] == "2026-07-22"
    assert parsed["original_contract_price"] == 60000
    assert parsed["remaining_balance"] == 49400
    assert parsed["adjustments"][0]["amount"] == -10000
    assert parsed["adjustments"][1]["amount"] == -600
    billed = [row for row in parsed["materials"] if row["billed"]]
    assert [row["amount"] for row in billed] == [6200, 4090]
    assert parsed["itemized_materials_total"] == 10290
    assert parsed["stated_materials_total"] == 10290
    assert parsed["labor_remainder"] == 39110
    assert [row["amount"] for row in parsed["payment_schedule"]] == [24000, 12700, 12700]
    assert parsed["estimated_days"] == 12
    assert any(section["title"] == "Kitchen" for section in parsed["scope"])
    assert any("HVAC" in line for line in parsed["exclusions"])


def test_rejects_a_file_that_is_not_a_proposal():
    with pytest.raises(ProposalParseError):
        parse_proposal(_docx(["Hello", "This is not a contract."]))


REAL = Path("/home/ubuntu/.cursor/projects/workspace/uploads/Revival_Revised_Remodeling_Proposal_Dino_Vickie_d25d.docx")


@pytest.mark.skipif(not REAL.exists(), reason="sample proposal is not on this machine")
def test_real_vickie_proposal():
    parsed = parse_proposal(REAL.read_bytes())
    assert parsed["client_name"] == "Dino & Vickie"
    assert "511 Dunaway" in parsed["project_address"]
    assert parsed["proposal_date"] == "2026-07-22"
    assert parsed["original_contract_price"] == 60000
    assert parsed["remaining_balance"] == 49400
    assert round(sum(item["amount"] for item in parsed["adjustments"]), 2) == -10600
    assert parsed["stated_materials_total"] == 21700
    assert parsed["itemized_materials_total"] == 25700
    assert parsed["materials_variance"] == 4000
    assert parsed["labor_remainder"] == 23700
    assert round(sum(row["amount"] for row in parsed["payment_schedule"]), 2) == 49400
    assert parsed["itemized_materials_total"] + parsed["labor_remainder"] == parsed["remaining_balance"]
    titles = [section["title"] for section in parsed["scope"]]
    assert "Kitchen" in titles
    assert "Bathroom" in titles
