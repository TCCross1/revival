"""Default monthly overhead catalog for Revival Pro."""

OVERHEAD_CATALOG = [
    {
        "name": "Insurance",
        "items": [
            "General Liability",
            "Workers’ Comp",
            "Contractors Medical / Health Insurance",
            "Commercial Auto",
            "Tools & Equipment Insurance",
        ],
    },
    {
        "name": "Vehicles & Fuel",
        "items": [
            "Truck/Trailer payments",
            "Fuel",
            "Maintenance & repairs",
        ],
    },
    {
        "name": "Shop / Storage / Office",
        "items": [
            "Shop or storage rent",
            "Utilities",
            "Internet / Phone",
        ],
    },
    {
        "name": "Software & Technology",
        "items": [
            "Revival Pro / hosting",
            "Accounting software",
            "Google Workspace",
            "Vapi / phone system",
            "Design / estimating tools",
        ],
    },
    {
        "name": "Marketing & Leads",
        "items": [
            "Thumbtack / Angi",
            "Google Ads",
            "Website & hosting",
        ],
    },
    {
        "name": "Professional Services",
        "items": [
            "Accountant / bookkeeper",
            "Attorney / legal",
            "Licensing & permits",
        ],
    },
    {
        "name": "Payroll",
        "items": [
            "Owner draw / salary",
            "Employee wages",
            "Payroll taxes",
        ],
    },
    {
        "name": "Tools & Equipment",
        "items": [
            "Tool replacement / repair",
            "Small equipment rentals",
        ],
    },
    {
        "name": "Miscellaneous",
        "items": [
            "Office supplies",
            "Uniforms / safety gear",
            "Training / education",
            "Bank / merchant fees",
            "Contingency",
        ],
    },
]

# Rename leftover default category names from the first books seed.
OVERHEAD_CATEGORY_RENAMES = {
    "Vehicles": "Vehicles & Fuel",
    "Software & Subscriptions": "Software & Technology",
    "Marketing": "Marketing & Leads",
    "Rent & Shop": "Shop / Storage / Office",
    "Other": "Miscellaneous",
}
