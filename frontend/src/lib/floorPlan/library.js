export const PROJECT_TYPES = ["Kitchen", "Bath", "Addition", "Whole House", "Deck", "Patio", "Basement", "Exterior", "Flooring", "Other"];
export const LEVEL_PRESETS = ["1st Floor", "2nd Floor", "3rd Floor", "Basement", "Attic", "Garage", "Outdoor"];
export const FLOORING = [
  { id: "lvp", name: "LVP", color: "#C4A574" },
  { id: "tile", name: "Tile", color: "#D8D3C8" },
  { id: "carpet", name: "Carpet", color: "#A8B5A2" },
  { id: "engineered_hardwood", name: "Engineered hardwood", color: "#B57A4A" },
  { id: "solid_hardwood", name: "Solid hardwood", color: "#8B5A2B" },
];
export const FOUNDATIONS = [
  { id: "slab", name: "Slab on grade" },
  { id: "crawl", name: "Crawl space" },
  { id: "basement", name: "Full basement" },
  { id: "pier", name: "Pier and beam" },
];
export const ROOF_KINDS = [
  { id: "gable", name: "Gable" },
  { id: "hip", name: "Hip" },
  { id: "shed", name: "Shed" },
  { id: "flat", name: "Flat / low slope" },
  { id: "gambrel", name: "Gambrel" },
];
export const DOOR_STYLES = [
  { id: "six-panel", name: "Six panel" },
  { id: "flush", name: "Flush" },
  { id: "french", name: "French" },
  { id: "sliding", name: "Sliding" },
  { id: "bi-fold", name: "Bi-fold" },
  { id: "pocket", name: "Pocket" },
];
export const WINDOW_STYLES = [
  { id: "double-hung", name: "Double hung" },
  { id: "single-hung", name: "Single hung" },
  { id: "casement", name: "Crank-out casement" },
  { id: "awning", name: "Crank-out awning" },
  { id: "slider", name: "Slider" },
  { id: "picture", name: "Picture / fixed" },
];
export const WINDOW_MATERIALS = [
  { id: "vinyl", name: "Vinyl" },
  { id: "vinyl-clad", name: "Vinyl clad" },
  { id: "wood", name: "Wood" },
  { id: "aluminum-clad", name: "Aluminum clad" },
];
export const WINDOW_INSTALLS = [
  { id: "new-construction", name: "New construction · extension jambs" },
  { id: "replacement", name: "Replacement · box / pocket" },
];
export const CABINET_DOOR_STYLES = [
  { id: "shaker", name: "Solid Shaker" },
  { id: "slab", name: "Slab / flat" },
  { id: "raised", name: "Raised panel" },
  { id: "recessed", name: "Recessed panel" },
  { id: "beadboard", name: "Beadboard" },
  { id: "glass", name: "Glass insert Shaker" },
  { id: "glass-frosted", name: "Frosted glass" },
  { id: "glass-mullion", name: "Mullion glass" },
];
export const CABINET_GLASS = [
  { id: "", name: "No glass" },
  { id: "clear", name: "Clear glass" },
  { id: "frosted", name: "Frosted glass" },
  { id: "seeded", name: "Seeded glass" },
];
export const WOOD_SPECIES = [
  { id: "oak", name: "White oak", color: "#D4B48A" },
  { id: "red-oak", name: "Red oak", color: "#C08A54" },
  { id: "maple", name: "Maple", color: "#E6D3B0" },
  { id: "cherry", name: "Cherry", color: "#8B4A2B" },
  { id: "walnut", name: "Walnut", color: "#6B4226" },
  { id: "hickory", name: "Hickory", color: "#B8884A" },
  { id: "alder", name: "Alder", color: "#C9A07A" },
  { id: "painted", name: "Painted (no grain)", color: "#F4F1EA" },
];
export const CABINET_CROWNS = [
  { id: "", name: "No crown" },
  { id: "cove-2", name: "Cove 2-1/2\"" },
  { id: "crown-35", name: "Crown 3-1/2\"" },
  { id: "crown-45", name: "Crown 4-1/2\"" },
  { id: "crown-525", name: "Crown 5-1/4\"" },
  { id: "built-up", name: "Built-up / stacked" },
];
export const FINISH_VARIANTS = [
  { id: "", name: "Natural oak", color: "#E8D5B5" },
  { id: "walnut", name: "Walnut", color: "#6B4226" },
  { id: "white", name: "Painted white", color: "#F4F1EA" },
  { id: "navy", name: "Painted navy", color: "#1E3A4C" },
  { id: "gray", name: "Painted gray", color: "#8A9094" },
  { id: "stone", name: "Honed stone", color: "#D9D3C7" },
  { id: "sage", name: "Painted sage", color: "#8A9A7B" },
  { id: "black", name: "Painted black", color: "#1A1C1E" },
  { id: "greige", name: "Painted greige", color: "#C4B8A8" },
  { id: "custom", name: "Custom paint / stain", color: "#C9A227" },
];
export const CABINET_CONFIGS = [
  { id: "single", name: "Single door" },
  { id: "doors", name: "Double doors" },
  { id: "drawer-doors", name: "Top drawer + doors" },
  { id: "drawers-3", name: "3-drawer / utensil" },
  { id: "drawers-4", name: "4-drawer stack" },
  { id: "trash", name: "Trash pull-out" },
  { id: "sink", name: "Sink base" },
  { id: "lazy-susan", name: "Corner lazy Susan" },
  { id: "blind", name: "Blind corner" },
  { id: "shelf", name: "Open shelf" },
  { id: "glass", name: "Glass doors" },
  { id: "fridge-wall", name: "Over refrigerator" },
  { id: "hood-wall", name: "Over range" },
];
export const HARDWARE_FINISHES = [
  { id: "nickel", name: "Brushed nickel", color: "#8A9198" },
  { id: "brass", name: "Brushed brass", color: "#C9A227" },
  { id: "gold", name: "Polished gold", color: "#E0C36A" },
  { id: "black", name: "Matte black", color: "#1A1C1E" },
  { id: "chrome", name: "Chrome", color: "#D8DEE2" },
];
export const HARDWARE_STYLES = [
  { id: "bar", name: "Bar pull" },
  { id: "knob", name: "Knob" },
  { id: "cup", name: "Cup pull" },
  { id: "none", name: "No hardware" },
];
export const HARDWARE_SIZES = [
  { id: "3", name: "3\" center" },
  { id: "4", name: "4\" center" },
  { id: "5", name: "5\" center" },
  { id: "6", name: "6\" / 128mm" },
  { id: "8", name: "8\" / 192mm" },
  { id: "12", name: "12\" appliance" },
];
export const SINK_TYPES = [
  { id: "undermount-rect", name: "Undermount rectangular" },
  { id: "undermount-oval", name: "Undermount oval" },
  { id: "double", name: "Double basin" },
  { id: "farm", name: "Farmhouse / apron" },
  { id: "vessel", name: "Vessel" },
  { id: "workstation", name: "Workstation" },
  { id: "top-mount", name: "Top-mount / drop-in" },
  { id: "corner", name: "Corner" },
  { id: "integrated", name: "Integrated" },
];
export const FAUCET_FINISHES = [
  { id: "nickel", name: "Brushed nickel" },
  { id: "brass", name: "Brass / gold" },
  { id: "gold", name: "Polished gold" },
  { id: "black", name: "Matte black" },
  { id: "chrome", name: "Chrome" },
  { id: "bronze", name: "Oil-rubbed bronze" },
];
export const FAUCET_STYLES = [
  { id: "gooseneck", name: "High-arc gooseneck" },
  { id: "pulldown", name: "Pull-down" },
  { id: "bridge", name: "Bridge" },
  { id: "widespread", name: "Widespread" },
  { id: "wall", name: "Wall mount" },
  { id: "pot-filler", name: "Pot filler" },
];
export const APPLIANCE_FUELS = [
  { id: "electric", name: "Electric" },
  { id: "gas", name: "Gas" },
  { id: "induction", name: "Induction" },
  { id: "dual", name: "Dual fuel" },
];
export const HOOD_TYPES = [
  { id: "wall", name: "Wall canopy" },
  { id: "island", name: "Island" },
  { id: "under", name: "Under-cabinet" },
  { id: "insert", name: "Insert / liner" },
  { id: "chimney", name: "Chimney" },
];
export const SHOWER_TYPES = [
  { id: "walk-in", name: "Walk-in / stand-up" },
  { id: "corner", name: "Corner" },
  { id: "neo", name: "Neo-angle" },
  { id: "alcove", name: "Alcove" },
  { id: "steam", name: "Steam" },
];
export const SHOWER_DOORS = [
  { id: "pivot", name: "Pivot" },
  { id: "sliding", name: "Sliding" },
  { id: "frameless", name: "Frameless" },
  { id: "framed", name: "Framed" },
  { id: "bifold", name: "Bi-fold" },
  { id: "fixed", name: "Fixed panel / open" },
];
export const SHOWER_GLASS = [
  { id: "clear", name: "Clear" },
  { id: "frosted", name: "Frosted" },
  { id: "rain", name: "Rain glass" },
  { id: "bronze", name: "Bronze tint" },
];
export const TUB_TYPES = [
  { id: "alcove", name: "Alcove" },
  { id: "freestanding", name: "Freestanding" },
  { id: "drop-in", name: "Drop-in" },
  { id: "jetted", name: "Jetted / Jacuzzi" },
  { id: "soaking", name: "Soaking" },
];
export const MIRROR_SHAPES = [
  { id: "rect", name: "Rectangular" },
  { id: "round", name: "Round" },
  { id: "arch", name: "Arched" },
];
export const TOILET_TYPES = [
  { id: "floor", name: "Floor-mount elongated" },
  { id: "compact", name: "Compact / round" },
  { id: "comfort", name: "Comfort height" },
  { id: "wall", name: "Wall-hung" },
];
export const HOUSE_STANDARD_DEFAULTS = {
  door_style: "shaker",
  finish: "white",
  species: "painted",
  hardware_finish: "brass",
  hardware_style: "bar",
  hardware_size: "5",
  counter_material: "carrara",
  edge_profile: "eased",
  faucet_finish: "nickel",
  faucet_style: "pulldown",
  appliance_finish: "stainless",
};
export const VANITY_MOUNTS = [
  { id: "floor", name: "Floor standing" },
  { id: "floating", name: "Floating / wall mount" },
];
export const EDGE_PROFILES = [
  { id: "eased", name: "Eased / square" },
  { id: "ogee", name: "Ogee" },
  { id: "bullnose", name: "Bullnose" },
  { id: "waterfall", name: "Waterfall" },
];
export const APPLIANCE_FINISHES = [
  { id: "stainless", name: "Stainless steel", color: "#C5CCD1" },
  { id: "black-stainless", name: "Black stainless", color: "#3A3F44" },
  { id: "white", name: "White enamel", color: "#F4F6F7" },
  { id: "black", name: "Black enamel", color: "#1A1C1E" },
  { id: "panel", name: "Panel ready", color: "#E8D5B5" },
];
export const COUNTER_MATERIALS = [
  { id: "quartz", name: "Quartz", color: "#E8E4DC" },
  { id: "carrara", name: "Carrara marble", color: "#F7F4EE" },
  { id: "calacatta", name: "Calacatta marble", color: "#F4F0E8" },
  { id: "marble", name: "Marble", color: "#F3F0EA" },
  { id: "granite", name: "Granite", color: "#5C5852" },
  { id: "formica", name: "Formica / laminate", color: "#D2C4B0" },
  { id: "butcher", name: "Butcher block", color: "#C4A574" },
  { id: "solid", name: "Solid surface", color: "#E4E8EA" },
  { id: "soapstone", name: "Soapstone", color: "#4A5256" },
  { id: "concrete", name: "Concrete look", color: "#B8B3AB" },
];
export const LIGHT_MOUNTS = [
  { id: "recessed", name: "Recessed can" },
  { id: "flush", name: "Flush mount" },
];

function item(group, subgroup, id, name, width, depth, height, tags = [], extras = {}) {
  return {
    id,
    group,
    subgroup,
    name,
    width,
    depth,
    height,
    tags,
    resizable: true,
    rotatable: true,
    line: extras.line || "",
    sku: extras.sku || "",
    manufacturer: extras.manufacturer || "",
    ...extras,
  };
}

function sized(group, subgroup, prefix, label, widths, depth, height, tags) {
  return widths.map((w) => item(group, subgroup, `${prefix}-${w}`, `${label} ${w}`, w, depth, height, tags));
}

const WALL_SIZES = [12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48];
const BASE_SINGLE = [9, 12, 15, 18, 21];
const BASE_DOUBLE = [24, 27, 30, 33, 36, 42, 48];

export const OBJECT_LIBRARY = [
  ...sized("Kitchen", "Base", "cab-base", "Single door base", BASE_SINGLE, 24, 34.5, ["cabinet", "base"]),
  ...sized("Kitchen", "Base", "cab-base", "Double door base", BASE_DOUBLE, 24, 34.5, ["cabinet", "base"]),
  item("Kitchen", "Base", "cab-base-custom", "Custom base cabinet", 27, 24, 34.5, ["cabinet", "base", "custom"]),
  item("Kitchen", "Drawers", "cab-utensil-12", "Utensil 3-drawer 12", 12, 24, 34.5, ["cabinet", "base", "drawers"]),
  item("Kitchen", "Drawers", "cab-utensil-15", "Utensil 3-drawer 15", 15, 24, 34.5, ["cabinet", "base", "drawers"]),
  item("Kitchen", "Drawers", "cab-utensil-18", "Utensil 3-drawer 18", 18, 24, 34.5, ["cabinet", "base", "drawers"]),
  item("Kitchen", "Drawers", "cab-utensil-21", "Utensil 3-drawer 21", 21, 24, 34.5, ["cabinet", "base", "drawers"]),
  ...sized("Kitchen", "Drawers", "cab-drawers-3", "3-drawer base", [12, 15, 18, 21, 24, 30, 36], 24, 34.5, ["cabinet", "base", "drawers"]),
  ...sized("Kitchen", "Drawers", "cab-drawers-4", "4-drawer stack", [12, 15, 18, 21, 24, 30, 36], 24, 34.5, ["cabinet", "base", "drawers"]),
  ...sized("Kitchen", "Drawers", "cab-drawer-doors", "Drawer over doors", [18, 21, 24, 30, 36, 42], 24, 34.5, ["cabinet", "base"]),
  ...sized("Kitchen", "Sink bases", "cab-sink", "Sink base", [24, 30, 33, 36, 42], 24, 34.5, ["cabinet", "sink", "base"]),
  item("Kitchen", "Sink bases", "cab-farm-30", "Farm sink base 30", 30, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
  item("Kitchen", "Sink bases", "cab-farm-36", "Farm sink base 36", 36, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
  item("Kitchen", "Sink bases", "cab-farm-42", "Farm sink base 42", 42, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
  ...sized("Kitchen", "Sink bases", "cab-trash", "Trash pull-out", [12, 15, 18, 21], 24, 34.5, ["cabinet", "trash", "base"]),
  item("Kitchen", "Corners", "cab-corner-33", "Corner lazy Susan 33", 33, 33, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-corner-36", "Corner lazy Susan 36", 36, 36, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-corner-42", "Corner lazy Susan 42", 42, 42, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-blind-36", "Blind corner 36", 36, 24, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-blind-39", "Blind corner 39", 39, 24, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-blind-42", "Blind corner 42", 42, 24, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-blind-45", "Blind corner 45", 45, 24, 34.5, ["cabinet", "corner", "base"]),
  item("Kitchen", "Corners", "cab-wall-corner-24", "Corner wall 24", 24, 24, 30, ["cabinet", "wall", "corner"]),
  item("Kitchen", "Corners", "cab-wall-corner-36", "Corner wall 36", 36, 36, 42, ["cabinet", "wall", "corner"]),
  item("Kitchen", "Corners", "cab-wall-diag-24", "Diagonal corner wall 24", 24, 24, 30, ["cabinet", "wall", "corner"]),
  ...WALL_SIZES.map((w) => item("Kitchen", "Wall", `cab-wall-${w}`, `Wall cabinet ${w}`, w, 12, w >= 36 ? 42 : 30, ["cabinet", "wall"])),
  item("Kitchen", "Wall", "cab-wall-custom", "Custom wall cabinet", 27, 12, 30, ["cabinet", "wall", "custom"]),
  ...sized("Kitchen", "Wall", "cab-wall-glass", "Glass wall cabinet", [18, 24, 27, 30, 36, 42, 48], 12, 30, ["cabinet", "wall", "glass"]),
  item("Kitchen", "Wall", "cab-wall-fridge-30", "Over-refrigerator wall 30", 30, 12, 18, ["cabinet", "wall"]),
  item("Kitchen", "Wall", "cab-wall-fridge-33", "Over-refrigerator wall 33", 33, 12, 18, ["cabinet", "wall"]),
  item("Kitchen", "Wall", "cab-wall-fridge-36", "Over-refrigerator wall 36", 36, 12, 18, ["cabinet", "wall"]),
  item("Kitchen", "Wall", "cab-wall-hood-30", "Over-range wall 30", 30, 12, 18, ["cabinet", "wall"]),
  item("Kitchen", "Wall", "cab-wall-hood-36", "Over-range wall 36", 36, 12, 18, ["cabinet", "wall"]),
  ...sized("Kitchen", "Shelves", "cab-shelf", "Open wall shelf", [18, 24, 30, 36, 42], 12, 12, ["cabinet", "wall", "shelf"]),
  item("Kitchen", "Shelves", "cab-shelf-corner-24", "Corner wall shelf 24", 24, 24, 12, ["cabinet", "wall", "shelf", "corner"]),
  ...sized("Kitchen", "Tall", "cab-tall", "Tall pantry", [12, 15, 18, 24, 30, 36], 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-oven-27", "Oven housing 27", 27, 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-oven-30", "Oven housing 30", 30, 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-fridge-panel-30", "Refrigerator panel 30", 30, 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-fridge-panel-36", "Refrigerator panel 36", 36, 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-fridge-panel-42", "Refrigerator panel 42", 42, 24, 84, ["cabinet", "tall"]),
  item("Kitchen", "Tall", "cab-micro-30", "Microwave cabinet 30", 30, 24, 84, ["cabinet", "microwave", "tall"]),
  item("Kitchen", "Tall", "cab-specialty", "Specialty cabinet", 18, 24, 34.5, ["cabinet"]),
  item("Kitchen", "Islands", "island-72", "Kitchen island 72", 72, 36, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-96", "Kitchen island 96", 96, 42, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-white-marble", "White marble island", 72, 36, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-classic-white", "Classic white island", 72, 36, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-walnut", "Walnut marble island", 72, 36, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-navy", "Navy brass island", 72, 36, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-oak", "Oak quartz island", 84, 42, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-black-waterfall", "Black waterfall island", 84, 42, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-seat-84", "Seating island 84", 84, 42, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-sink-72", "Island with sink 72", 72, 36, 36, ["island", "base", "sink"]),
  item("Kitchen", "Islands", "island-cooktop-84", "Island with cooktop 84", 84, 42, 36, ["island", "base"]),
  item("Kitchen", "Islands", "island-double-108", "Double-depth island 108", 108, 48, 36, ["island", "base"]),
  item("Kitchen", "Islands", "peninsula-84", "Peninsula 84", 84, 24, 36, ["peninsula", "base"]),
  item("Kitchen", "Countertops", "counter-run", "Countertop run", 36, 25, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-quartz", "Quartz counter run", 48, 25.5, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-marble", "Marble counter run", 48, 25.5, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-granite", "Granite counter run", 48, 25.5, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-butcher", "Butcher-block run", 48, 25, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-concrete", "Concrete-look run", 48, 25.5, 1.5, ["countertop"]),
  item("Kitchen", "Countertops", "counter-island-top", "Island countertop", 72, 42, 1.5, ["countertop"]),
  item("Kitchen", "Hoods", "hood-wall-30", "Wall range hood", 30, 20, 18, ["hood"]),
  item("Kitchen", "Hoods", "hood-island-36", "Island range hood", 36, 24, 18, ["hood"]),
  item("Kitchen", "Hoods", "hood-island-42", "Island hood 42", 42, 27, 18, ["hood"]),
  item("Kitchen", "Hoods", "hood-insert", "Cabinet-insert hood", 30, 18, 10, ["hood"]),
  item("Kitchen", "Hoods", "hood-under-30", "Under-cabinet hood 30", 30, 18, 8, ["hood"]),
  item("Kitchen", "Hoods", "hood-chimney-30", "Chimney hood 30", 30, 20, 28, ["hood"]),
  item("Kitchen", "Hoods", "hood-chimney-36", "Chimney hood 36", 36, 20, 32, ["hood"]),
  item("Kitchen", "Vents", "vent-ceiling", "Ceiling vent", 12, 12, 2, ["vent"]),
  item("Kitchen", "Vents", "vent-wall", "Wall vent", 12, 4, 8, ["vent"]),
  item("Kitchen", "Vents", "vent-cabinet", "Cabinet vent", 6, 12, 4, ["vent"]),
  item("Kitchen", "Appliances", "range-30", "Range 30", 30, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-36", "Range 36 stainless", 36, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-black-ss", "Black stainless range", 36, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-white", "White enamel range", 30, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-gas-30", "Gas range 30", 30, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-gas-36", "Gas range 36", 36, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-induction-30", "Induction range 30", 30, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "range-induction-36", "Induction range 36", 36, 24, 36, ["appliance"]),
  item("Kitchen", "Appliances", "cooktop-30", "Cooktop 30", 30, 21, 3, ["appliance"]),
  item("Kitchen", "Appliances", "cooktop-36", "Induction cooktop 36", 36, 21, 3, ["appliance"]),
  item("Kitchen", "Appliances", "cooktop-gas-30", "Gas cooktop 30", 30, 21, 3, ["appliance"]),
  item("Kitchen", "Appliances", "cooktop-gas-36", "Gas cooktop 36", 36, 21, 3, ["appliance"]),
  item("Kitchen", "Appliances", "oven-wall", "Wall oven", 30, 24, 29, ["appliance"]),
  item("Kitchen", "Appliances", "oven-wall-double", "Double wall oven", 30, 24, 52, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-30", "Refrigerator 30", 30, 24, 68, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-36", "Refrigerator 36 stainless", 36, 24, 70, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-42", "Refrigerator 42", 42, 24, 72, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-french-36", "French-door fridge 36", 36, 24, 70, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-bottom-36", "Bottom-freezer fridge 36", 36, 24, 70, ["appliance"]),
  item("Kitchen", "Appliances", "fridge-panel", "Panel-ready refrigerator", 36, 24, 70, ["appliance"]),
  item("Kitchen", "Appliances", "wine-fridge", "Wine fridge", 24, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "wine-fridge-15", "Wine fridge 15", 15, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "ice-maker", "Ice maker", 15, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "dw-18", "Dishwasher 18", 18, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "dw-24", "Dishwasher 24 stainless", 24, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "dw-panel", "Panel-ready dishwasher", 24, 24, 34, ["appliance"]),
  item("Kitchen", "Appliances", "micro-24", "Microwave 24", 24, 16, 14, ["appliance"]),
  item("Kitchen", "Appliances", "micro-drawer", "Microwave drawer", 24, 24, 16, ["appliance"]),
  item("Kitchen", "Appliances", "micro-over-30", "Over-range microwave 30", 30, 16, 17, ["appliance"]),
  item("Kitchen", "Sinks", "sink-33", "Kitchen sink 33", 33, 22, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-farm-33", "Farmhouse apron sink", 33, 22, 10, ["plumbing", "farm"]),
  item("Kitchen", "Sinks", "sink-double-33", "Double basin sink", 33, 22, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-composite-33", "Black composite sink", 33, 22, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-copper-33", "Copper farmhouse sink", 33, 22, 10, ["plumbing", "farm"]),
  item("Kitchen", "Sinks", "sink-work-36", "Workstation sink 36", 36, 22, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-vessel-white", "White vessel sink", 18, 18, 7, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-vessel-black", "Black vessel sink", 18, 18, 7, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-undermount-oval", "Undermount oval sink", 20, 16, 8, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-undermount-rect", "Undermount rectangular sink", 21, 16, 8, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-topmount-33", "Top-mount sink 33", 33, 22, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-corner-32", "Corner sink 32", 32, 32, 10, ["plumbing"]),
  item("Kitchen", "Sinks", "sink-bar-15", "Bar / prep sink 15", 15, 15, 8, ["plumbing"]),
  item("Kitchen", "Faucets", "faucet-pulldown", "Pull-down kitchen faucet", 8, 8, 16, ["plumbing"]),
  item("Kitchen", "Faucets", "faucet-bridge", "Bridge kitchen faucet", 10, 8, 12, ["plumbing"]),
  item("Kitchen", "Faucets", "faucet-potfiller", "Pot filler", 4, 18, 10, ["plumbing"]),
  item("Kitchen", "Appliances", "disposal", "Disposal", 8, 8, 12, ["appliance", "plumbing"]),
  item("Kitchen", "Appliances", "washer", "Washer", 27, 24, 39, ["appliance", "plumbing"]),
  item("Kitchen", "Appliances", "dryer", "Electric dryer", 27, 24, 39, ["appliance"]),
  item("Bath", "Vanities", "vanity-single-24", "Single vanity 24", 24, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-single-30", "Single vanity 30", 30, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-single-36", "Single vanity 36", 36, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-single-42", "Single vanity 42", 42, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-single-48", "Single vanity 48", 48, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-double-60", "Double vanity 60", 60, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-double-72", "Double vanity 72", 72, 22, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-float-36", "Floating vanity 36", 36, 18, 20, ["vanity"]),
  item("Bath", "Vanities", "vanity-float-48", "Floating vanity 48", 48, 18, 20, ["vanity"]),
  item("Bath", "Vanities", "vanity-float-60", "Floating vanity 60", 60, 18, 20, ["vanity"]),
  item("Bath", "Vanities", "vanity-oak-float", "Floating oak vanity", 48, 18, 20, ["vanity"]),
  item("Bath", "Vanities", "vanity-walnut-double", "Dark walnut double vanity", 60, 22, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-black-marble", "Black cabinet marble vanity", 36, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-gray-shaker", "Gray shaker vanity", 60, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-concrete", "Concrete floating vanity", 36, 18, 18, ["vanity"]),
  item("Bath", "Vanities", "vanity-furniture-36", "Furniture vanity 36", 36, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-furniture-white", "White furniture vanity", 36, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-black-modern", "Black modern vanity", 36, 18, 20, ["vanity"]),
  item("Bath", "Vanities", "vanity-classic", "Classic traditional vanity", 36, 21, 34, ["vanity"]),
  item("Bath", "Vanities", "vanity-midcentury", "Mid-century vanity", 36, 21, 32, ["vanity"]),
  item("Bath", "Cabinets", "cab-wall-toilet-24", "Over-toilet wall 24", 24, 12, 30, ["cabinet", "wall", "bath", "over-toilet"]),
  item("Bath", "Cabinets", "cab-wall-toilet-30", "Over-toilet wall 30", 30, 12, 30, ["cabinet", "wall", "bath", "over-toilet"]),
  item("Bath", "Tops", "vanity-top-36", "Vanity top 36", 36, 22, 1.25, ["countertop", "vanity"]),
  item("Bath", "Tops", "vanity-top-60", "Vanity top 60", 60, 22, 1.25, ["countertop", "vanity"]),
  item("Bath", "Mirrors", "mirror-36", "Vanity mirror 36", 36, 2, 36, ["mirror"]),
  item("Bath", "Mirrors", "mirror-60", "Vanity mirror 60", 60, 2, 36, ["mirror"]),
  item("Bath", "Mirrors", "mirror-round-30", "Round mirror 30", 30, 2, 30, ["mirror"]),
  item("Bath", "Mirrors", "mirror-arch-36", "Arched mirror 36", 36, 2, 42, ["mirror"]),
  item("Bath", "Mirrors", "mirror-lighted-36", "Lighted mirror 36", 36, 2, 36, ["mirror", "light"]),
  item("Bath", "Mirrors", "mirror-lighted-60", "Lighted mirror 60", 60, 2, 36, ["mirror", "light"]),
  item("Bath", "Showers", "shower-walk-36", "Walk-in shower 36×36", 36, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-walk-48", "Walk-in shower 48×36", 48, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-walk-60", "Walk-in shower 60×36", 60, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-corner-36", "Corner shower 36×36", 36, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-neo-42", "Neo-angle shower 42", 42, 42, 80, ["shower"]),
  item("Bath", "Showers", "shower-frameless", "Frameless glass shower", 48, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-framed-48", "Framed glass shower 48", 48, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-black-frame", "Black-frame walk-in shower", 36, 36, 80, ["shower"]),
  item("Bath", "Showers", "shower-bifold-60", "Bi-fold tub/shower door 60", 60, 2, 58, ["glass", "shower"]),
  item("Bath", "Showers", "shower-steam", "Steam shower", 48, 48, 84, ["shower"]),
  item("Bath", "Showers", "shower-glass-pivot", "Pivot glass door", 30, 2, 78, ["glass"]),
  item("Bath", "Showers", "shower-glass-slide", "Sliding glass door", 48, 2, 78, ["glass"]),
  item("Bath", "Showers", "shower-glass-fixed", "Fixed glass panel", 30, 2, 78, ["glass"]),
  item("Bath", "Showers", "niche-12", "Shower niche", 12, 4, 12, ["niche"]),
  item("Bath", "Showers", "niche-mosaic", "Mosaic niche", 16, 4, 8, ["niche"]),
  item("Bath", "Showers", "niche-steam", "Steam niche", 16, 4, 8, ["niche"]),
  item("Bath", "Showers", "bench-48", "Shower bench", 48, 14, 18, ["bench"]),
  item("Bath", "Showers", "bench-corner", "Corner shower bench", 24, 24, 18, ["bench"]),
  item("Bath", "Showers", "drain-linear", "Linear drain", 36, 3, 1, ["plumbing"]),
  item("Bath", "Showers", "rain-head", "Rain shower head", 12, 12, 4, ["plumbing"]),
  item("Bath", "Showers", "rain-head-16", "Rain head 16", 16, 16, 4, ["plumbing"]),
  item("Bath", "Showers", "handheld", "Handheld shower combo", 6, 4, 24, ["plumbing"]),
  item("Bath", "Showers", "body-spray", "Body spray", 4, 4, 4, ["plumbing"]),
  item("Bath", "Showers", "shower-valve", "Shower valve trim", 8, 4, 8, ["plumbing"]),
  item("Bath", "Fixtures", "tub-60", "Alcove tub 60", 60, 32, 18, ["tub"]),
  item("Bath", "Fixtures", "tub-free", "Freestanding tub", 66, 32, 24, ["tub"]),
  item("Bath", "Fixtures", "tub-dropin-60", "Drop-in tub 60", 60, 32, 20, ["tub"]),
  item("Bath", "Fixtures", "tub-jetted-60", "Jetted tub 60", 60, 32, 22, ["tub"]),
  item("Bath", "Fixtures", "tub-soak-66", "Soaking tub 66", 66, 32, 24, ["tub"]),
  item("Bath", "Fixtures", "tub-japanese", "Japanese soaking tub", 48, 48, 28, ["tub"]),
  item("Bath", "Fixtures", "tub-black", "Matte black soaking tub", 66, 32, 24, ["tub"]),
  item("Bath", "Fixtures", "toilet", "Toilet", 18, 28, 30, ["plumbing"]),
  item("Bath", "Fixtures", "toilet-elongated", "Elongated toilet", 18, 30, 30, ["plumbing"]),
  item("Bath", "Fixtures", "toilet-compact", "Compact toilet", 16, 26, 28, ["plumbing"]),
  item("Bath", "Fixtures", "toilet-comfort", "Comfort-height toilet", 18, 30, 31, ["plumbing"]),
  item("Bath", "Fixtures", "toilet-wall", "Wall-hung toilet", 15, 22, 22, ["plumbing"]),
  item("Bath", "Fixtures", "faucet-wall", "Wall-mount faucet", 8, 4, 6, ["plumbing"]),
  item("Bath", "Fixtures", "faucet-widespread", "Widespread faucet", 8, 4, 8, ["plumbing"]),
  item("Bath", "Fixtures", "faucet-black", "Matte black faucet", 8, 4, 8, ["plumbing"]),
  item("Bath", "Fixtures", "faucet-gold", "Brushed gold faucet", 8, 4, 8, ["plumbing"]),
  item("Bath", "Accessories", "towel-bar-24", "Towel bar 24", 24, 3, 2, ["trim"]),
  item("Bath", "Accessories", "towel-ring", "Towel ring", 8, 3, 8, ["trim"]),
  item("Bath", "Accessories", "robe-hook", "Robe hook", 3, 3, 3, ["trim"]),
  item("Bath", "Accessories", "tp-holder", "Toilet paper holder", 8, 3, 3, ["trim"]),
  item("Lighting", "Ceiling", "light-recessed", "Recessed can", 6, 6, 4, ["light", "recessed"]),
  item("Lighting", "Ceiling", "light-flush", "Flush mount", 12, 12, 4, ["light", "flush"]),
  item("Lighting", "Ceiling", "light-layout", "Auto room lighting", 8, 8, 4, ["light", "layout"]),
  item("Lighting", "Ceiling", "light-pendant", "Pendant", 8, 8, 18, ["light"]),
  item("Lighting", "Ceiling", "light-linear", "Linear pendant", 36, 6, 8, ["light"]),
  item("Lighting", "Ceiling", "light-chandelier", "Chandelier point", 20, 20, 24, ["light"]),
  item("Lighting", "Wall", "light-vanity", "Vanity light", 24, 4, 6, ["light"]),
  item("Lighting", "Wall", "light-vanity-36", "Vanity bar 36", 36, 4, 6, ["light"]),
  item("Lighting", "Wall", "light-sconce", "Wall sconce", 6, 4, 12, ["light"]),
  item("Lighting", "Wall", "light-sconce-pair", "Sconce pair", 6, 4, 12, ["light"]),
  item("Lighting", "Cabinet", "light-undercab", "Under-cabinet light", 24, 2, 1, ["light"]),
  item("Lighting", "Ceiling", "fan-ceiling", "Ceiling fan", 42, 42, 14, ["electrical", "fan"]),
  item("Lighting", "Ceiling", "fan-light", "Ceiling fan with light", 42, 42, 16, ["electrical", "fan", "light"]),
  item("Architectural", "Fireplace", "fp-gas", "Gas fireplace", 48, 18, 42, ["fireplace"]),
  item("Architectural", "Fireplace", "fp-wood", "Wood fireplace", 48, 24, 48, ["fireplace"]),
  item("Architectural", "Fireplace", "fp-electric", "Electric fireplace", 50, 8, 20, ["fireplace"]),
  item("Architectural", "Fireplace", "fp-modern", "Modern linear fireplace", 72, 12, 16, ["fireplace"]),
  item("Architectural", "Stairs", "stairs-straight", "Straight stairs", 36, 120, 108, ["stairs"]),
  item("Architectural", "Stairs", "stairs-l", "L stairs", 96, 96, 108, ["stairs"]),
  item("Architectural", "Stairs", "stairs-u", "U stairs", 96, 120, 108, ["stairs"]),
  item("Architectural", "Stairs", "stairs-spiral", "Spiral stairs", 60, 60, 108, ["stairs"]),
  item("Architectural", "Deck", "deck-12x12", "Deck 12×12", 144, 144, 36, ["deck"]),
  item("Architectural", "Deck", "deck-16x20", "Deck 16×20", 192, 240, 36, ["deck"]),
  item("Architectural", "Deck", "patio-cover", "Covered patio", 192, 144, 108, ["patio"]),
  item("Architectural", "Deck", "railing-8", "Deck railing 8'", 96, 4, 36, ["railing"]),
  item("Architectural", "Deck", "deck-stairs", "Deck stairs", 36, 48, 36, ["stairs"]),
  item("Architectural", "Addition", "addition-room", "Room addition", 168, 144, 108, ["addition"]),
  item("Finishes", "Trim", "baseboard", "Baseboard run", 96, 1, 5.25, ["trim"]),
  item("Finishes", "Trim", "crown", "Crown molding", 96, 1, 4.5, ["trim"]),
  item("Finishes", "Trim", "cove", "Cove molding", 96, 1, 2.5, ["trim"]),
  item("Finishes", "Trim", "toekick", "Kick plate / toe kick", 96, 4, 4.5, ["trim"]),
  item("Finishes", "Trim", "filler", "Filler strip", 3, 24, 34.5, ["trim", "filler"]),
  item("Finishes", "Trim", "touchup", "Touch-up kit", 8, 6, 2, ["finish"]),
  item("MEP", "Electrical", "outlet-duplex", "Duplex outlet", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "outlet-gfci", "GFCI outlet", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "outlet-afci", "AFCI receptacle", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "switch", "Light switch", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "switch-dimmer", "Dimmer switch", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "switch-3way", "3-way switch", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "switch-gfci", "GFCI switch", 6, 6, 4, ["electrical"]),
  item("MEP", "Electrical", "panel", "Electrical panel", 14, 4, 30, ["electrical"]),
  item("MEP", "Electrical", "smoke", "Smoke / CO", 6, 6, 4, ["electrical"]),
  item("MEP", "HVAC", "hvac-ah", "Air handler", 24, 24, 48, ["hvac"]),
  item("MEP", "HVAC", "hvac-condenser", "Condenser / heat pump", 36, 36, 36, ["hvac"]),
  item("MEP", "Plumbing", "supply", "Water supply", 4, 4, 4, ["plumbing"]),
  item("MEP", "Plumbing", "drain", "Floor drain", 6, 6, 2, ["plumbing"]),
  item("MEP", "Plumbing", "hose-bib", "Hose bib", 4, 4, 6, ["plumbing"]),
  item("MEP", "Plumbing", "wh-40", "Water heater 40 gal", 22, 22, 60, ["plumbing"]),
  item("MEP", "Plumbing", "wh-50", "Water heater 50 gal", 24, 24, 62, ["plumbing"]),
  item("MEP", "Plumbing", "wh-tankless", "Tankless water heater", 18, 10, 30, ["plumbing"]),
  item("Structural", "Beams", "lvl-single", "Single LVL", 96, 4, 12, ["lvl"]),
  item("Structural", "Beams", "lvl-double", "Double LVL", 96, 6, 12, ["lvl"]),
  item("Structural", "Beams", "lvl-triple", "Triple LVL", 96, 8, 14, ["lvl"]),
  item("Openings", "Doors", "door-int-32", "Interior door 32", 32, 6, 80, ["door"]),
  item("Openings", "Doors", "door-ext-36", "Exterior door 36", 36, 6, 80, ["door"]),
  item("Openings", "Doors", "door-french", "French door pair 60", 60, 6, 80, ["door"]),
  item("Openings", "Doors", "door-french-48", "Interior French pair 48 · 4 lites each", 48, 6, 80, ["door"], { lites: 4, leafs: 2, sku: "FD-48-4V", manufacturer: "", description: "Double interior French doors, 24\" leaves, 4 vertical glass lites per door." }),
  item("Openings", "Windows", "win-dh-36", "Double-hung 36", 36, 6, 48, ["window"]),
  item("Openings", "Windows", "win-sh-36", "Single-hung 36", 36, 6, 48, ["window"]),
  item("Openings", "Windows", "win-slider-60", "Slider 60", 60, 6, 48, ["window"]),
  item("Openings", "Windows", "win-picture-48", "Picture window 48", 48, 6, 48, ["window"]),
  item("Openings", "Windows", "win-casement", "Crank-out casement 24", 24, 6, 48, ["window"]),
  item("Openings", "Windows", "win-awning", "Crank-out awning 36", 36, 6, 24, ["window"]),
  item("Openings", "Openings", "cased-36", "Cased opening 36", 36, 6, 80, ["cased"]),
  item("Openings", "Openings", "cased-72", "Cased opening 6'", 72, 6, 80, ["cased"]),
];

export function libraryById(id) {
  return OBJECT_LIBRARY.find((row) => row.id === id);
}

export function libraryGroups() {
  const groups = [];
  OBJECT_LIBRARY.forEach((row) => {
    let group = groups.find((g) => g.name === row.group);
    if (!group) {
      group = { name: row.group, items: [] };
      groups.push(group);
    }
    group.items.push(row);
  });
  return groups;
}

export function optionName(list, id, fallback = "") {
  const found = (list || []).find((row) => (typeof row === "string" ? row : row.id) === id);
  if (!found) return fallback || id || "";
  return typeof found === "string" ? found : found.name;
}

export function objectTags(obj) {
  return obj?.tags || libraryById(obj?.library_id)?.tags || [];
}

export function isFillerObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  const tags = objectTags(obj);
  return id.startsWith("filler") || tags.includes("filler");
}

export function isIslandObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  const tags = objectTags(obj);
  return tags.includes("island") || id.startsWith("island");
}

export function isCabinetObject(obj) {
  const tags = objectTags(obj);
  const id = String(obj?.library_id || obj?.id || "");
  if (tags.includes("countertop") || id.startsWith("counter") || id.startsWith("vanity-top")) return false;
  if (isFillerObject(obj)) return false;
  return tags.includes("cabinet") || tags.includes("island") || tags.includes("peninsula") || tags.includes("vanity")
    || id.startsWith("cab-") || id.startsWith("island") || id.startsWith("peninsula") || id.startsWith("vanity");
}

export function isBaseRunObject(obj) {
  const tags = objectTags(obj);
  const id = String(obj?.library_id || "");
  if (tags.includes("wall") || tags.includes("tall") || id.includes("wall") || id.includes("tall") || id.includes("shelf")) return false;
  return tags.includes("base") || tags.includes("island") || tags.includes("peninsula") || tags.includes("sink")
    || id.startsWith("cab-base") || id.startsWith("island") || id.startsWith("peninsula") || id.startsWith("cab-sink")
    || id.startsWith("cab-utensil") || id.startsWith("cab-drawers") || id.startsWith("cab-drawer-doors") || id.startsWith("cab-blind") || id.startsWith("cab-farm") || id.startsWith("cab-trash");
}

export function isWallCabinetObject(obj) {
  const tags = objectTags(obj);
  const id = String(obj?.library_id || obj?.id || "");
  return tags.includes("wall") || tags.includes("shelf") || id.startsWith("cab-wall") || id.startsWith("cab-shelf");
}

export const DRAWER_CABINET_CONFIGS = ["drawer-doors", "drawers-3", "drawers-4"];

export function isDrawerCabinetConfig(config) {
  return DRAWER_CABINET_CONFIGS.includes(String(config || ""));
}

export function isOverToiletCabinet(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  const tags = objectTags(obj);
  return id.includes("cab-wall-toilet") || tags.includes("over-toilet");
}

function isBathRoom(room) {
  return /bath|powder|toilet|wc|lav|half[\s-]?bath/i.test(String(room?.name || ""));
}

function objectBox(obj) {
  const front = obj?.front || "south";
  const x = Number(obj?.x) || 0;
  const y = Number(obj?.y) || 0;
  const w = Number(obj?.width) || 0;
  const d = Number(obj?.depth) || 0;
  if (front === "east" || front === "west") return { x, y, w: d, h: w };
  return { x, y, w, h: d };
}

function boxesOverlap(a, b, pad = 4) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

export function wallCabinetOverToilet(obj, level) {
  if (!isWallCabinetObject(obj)) return false;
  if (isOverToiletCabinet(obj)) return true;
  const toilets = (level?.objects || []).filter((other) => other && other.id !== obj.id && isToiletObject(other));
  if (!toilets.length) return false;
  const cab = objectBox(obj);
  const rooms = level?.rooms || [];
  const inBath = !rooms.length || rooms.some((room) => {
    const box = { x: Number(room.x) || 0, y: Number(room.y) || 0, w: Number(room.width) || 0, h: Number(room.depth) || 0 };
    return isBathRoom(room) && boxesOverlap(cab, box, 0);
  });
  if (!inBath) return false;
  return toilets.some((toilet) => boxesOverlap(cab, objectBox(toilet), 10));
}

export function wallCabinetAllowsDrawer(obj, level) {
  if (!isWallCabinetObject(obj)) return true;
  return wallCabinetOverToilet(obj, level);
}

function doorConfigForWall(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  if (obj?.glass || id.includes("glass")) return "glass";
  if (id.includes("shelf") || (obj?.tags || []).includes("shelf")) return "shelf";
  if (id.includes("corner") || id.includes("diag")) return "lazy-susan";
  if (id.includes("fridge")) return "fridge-wall";
  if (id.includes("hood")) return "hood-wall";
  if (Number(obj?.width) < 24) return "single";
  return "doors";
}

export function resolvedCabinetConfig(obj, level) {
  const raw = obj?.config || defaultCabinetConfig(obj);
  if (isWallCabinetObject(obj) && isDrawerCabinetConfig(raw) && !wallCabinetAllowsDrawer(obj, level)) {
    return doorConfigForWall(obj);
  }
  return raw;
}

export function cabinetConfigOptions(obj, level) {
  const wall = isWallCabinetObject(obj);
  const allowDrawer = !wall || wallCabinetAllowsDrawer(obj, level);
  const wide = Number(obj?.width) > 24;
  return CABINET_CONFIGS.filter((row) => {
    if (!allowDrawer && isDrawerCabinetConfig(row.id)) return false;
    if (wall && (row.id === "trash" || row.id === "sink")) return false;
    if (wide && row.id === "single") return false;
    return true;
  });
}

export function professionalDoorCount(width, config = "") {
  const w = Number(width) || 0;
  const cfg = String(config || "");
  if (cfg === "drawers-3" || cfg === "drawers-4") return 1;
  if (cfg === "trash" && w <= 24) return 1;
  if (cfg === "single" && w <= 24) return 1;
  if (w <= 24) return 1;
  if (w <= 48) return 2;
  let n = Math.round(w / 24);
  if (n < 2) n = 2;
  if (n % 2 === 1) n += 1;
  return n;
}

export function enforceCabinetConfig(obj) {
  if (!obj) return obj;
  if (!isCabinetObject(obj) && !isIslandObject(obj)) return obj;
  const w = Number(obj.width) || 0;
  let config = obj.config || defaultCabinetConfig(obj);
  if (w > 24 && config === "single") config = "doors";
  if (isIslandObject(obj) && (obj.config === "sink" || String(obj.library_id || "").includes("sink")) && w > 24 && config === "single") {
    config = "sink";
  }
  return { ...obj, config };
}

export function applyWallCabinetDrawerRule(obj, level) {
  if (!obj) return obj;
  try {
    let next = obj;
    if (isWallCabinetObject(obj)) {
      const allow = wallCabinetAllowsDrawer(obj, level);
      next = { ...obj, over_toilet: allow };
      if (isDrawerCabinetConfig(next.config) && !allow) {
        next.config = doorConfigForWall(next);
      }
    }
    return enforceCabinetConfig(next);
  } catch (err) {
    console.error("Wall cabinet drawer rule failed", err);
    return obj;
  }
}

export function isCountertopObject(obj) {
  const tags = objectTags(obj);
  return tags.includes("countertop") || String(obj?.library_id || "").startsWith("counter") || String(obj?.library_id || "").startsWith("vanity-top");
}

export function isApplianceFinishObject(obj) {
  const tags = objectTags(obj);
  const id = String(obj?.library_id || "");
  return tags.includes("appliance") || /^(range|fridge|dw-|micro|washer|dryer|cooktop|oven|wine|ice)/.test(id);
}

export function isShowerObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return objectTags(obj).includes("shower") || id.startsWith("shower");
}

export function isTubObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return objectTags(obj).includes("tub") || id.startsWith("tub");
}

export function isHoodObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return objectTags(obj).includes("hood") || id.startsWith("hood");
}

export function isFaucetObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return id.startsWith("faucet") || id.includes("potfiller");
}

export function isMirrorObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return objectTags(obj).includes("mirror") || id.startsWith("mirror");
}

export function isToiletObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return id === "toilet" || id.startsWith("toilet-");
}

export function isSinkObject(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  return id.startsWith("sink") || objectTags(obj).includes("sink") || (objectTags(obj).includes("plumbing") && id.includes("sink"));
}

export function catalogUniqueIds() {
  const ids = OBJECT_LIBRARY.map((row) => row.id);
  return ids.length === new Set(ids).size;
}

export function cabinetFill(obj) {
  if (obj?.finish === "custom" && obj?.color) return obj.color;
  const painted = FINISH_VARIANTS.find((f) => f.id && f.id === (obj?.finish || ""));
  if (painted) return painted.color;
  const species = WOOD_SPECIES.find((s) => s.id === (obj?.species || ""));
  if (species) return species.color;
  return (FINISH_VARIANTS.find((f) => f.id === (obj?.finish || "")) || FINISH_VARIANTS[0]).color;
}

export function defaultCabinetConfig(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("utensil") || id.includes("drawers-3")) return "drawers-3";
  if (id.includes("drawers-4")) return "drawers-4";
  if (id.includes("drawer-doors") || id.includes("drawer-door")) return "drawer-doors";
  if (isWallCabinetObject(libItem) || id.startsWith("cab-wall")) {
    if (id.includes("toilet") || (libItem?.tags || []).includes("over-toilet")) return "drawer-doors";
    if (id.includes("shelf")) return "shelf";
    if (id.includes("glass")) return "glass";
    if (id.includes("corner") || id.includes("diag")) return "lazy-susan";
    if (id.includes("fridge")) return "fridge-wall";
    if (id.includes("hood")) return "hood-wall";
    if (id.includes("single") || (libItem?.width || 0) < 24) return "single";
    return "doors";
  }
  if (id.includes("single") || /cab-base-(12|15|18|21)$/.test(id)) return "single";
  if (id.includes("shelf")) return "shelf";
  if (id.includes("glass")) return "glass";
  if (id.includes("blind")) return "blind";
  if (id.includes("trash")) return "trash";
  if (id.includes("farm") || id.includes("sink")) return "sink";
  if (id.includes("corner") || id.includes("diag")) return "lazy-susan";
  if (id.includes("fridge") && (id.includes("wall") || id.includes("over"))) return "fridge-wall";
  if (id.includes("hood") && id.startsWith("cab-wall")) return "hood-wall";
  if (id.includes("vanity-double")) return "drawers-3";
  if (id.includes("vanity")) return "drawer-doors";
  if (id.includes("island") && id.includes("sink")) return "sink";
  if (id.includes("island") && (libItem?.width || 0) > 24) return "doors";
  if ((libItem?.width || 0) > 24 && id.includes("single")) return "doors";
  if ((libItem?.width || 0) >= 30) return "drawer-doors";
  if ((libItem?.width || 0) > 24) return "doors";
  return "doors";
}

export function defaultFuel(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("induction")) return "induction";
  if (id.includes("gas")) return "gas";
  if (id.startsWith("range") || id.startsWith("cooktop")) return "electric";
  return "";
}

export function defaultHoodType(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("island")) return "island";
  if (id.includes("insert")) return "insert";
  if (id.includes("under")) return "under";
  if (id.includes("chimney")) return "chimney";
  if (id.startsWith("hood")) return "wall";
  return "";
}

export function defaultShowerDoor(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("pivot")) return "pivot";
  if (id.includes("slide")) return "sliding";
  if (id.includes("bifold")) return "bifold";
  if (id.includes("framed") || id.includes("black-frame")) return "framed";
  if (id.includes("frameless")) return "frameless";
  if (id.includes("neo") || id.includes("corner")) return "pivot";
  if (id.startsWith("shower")) return "frameless";
  return "";
}

export function defaultTubType(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("jetted")) return "jetted";
  if (id.includes("dropin") || id.includes("drop-in")) return "drop-in";
  if (id.includes("japanese") || id.includes("soak") || id.includes("black")) return "soaking";
  if (id.includes("free")) return "freestanding";
  if (id.startsWith("tub")) return "alcove";
  return "";
}

export function defaultMirrorShape(libItem) {
  const id = String(libItem?.id || libItem?.library_id || "");
  if (id.includes("round")) return "round";
  if (id.includes("arch")) return "arch";
  return "rect";
}

export function applianceFill(obj) {
  return (APPLIANCE_FINISHES.find((f) => f.id === (obj?.appliance_finish || obj?.finish || "stainless")) || APPLIANCE_FINISHES[0]).color;
}

export function counterFill(obj) {
  return (COUNTER_MATERIALS.find((f) => f.id === (obj?.counter_material || obj?.finish || "quartz")) || COUNTER_MATERIALS[0]).color;
}
