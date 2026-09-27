import {
  adviseDevice,
  ELEC_DISCLAIMER,
  findPanelObject,
  homeRunPath as designHomeRun,
  isElectricalObject as designIsElectrical,
} from "./electricalDesign";

export { ELEC_DISCLAIMER };

export function adviseElectrician(obj, ctx = {}) {
  return adviseDevice(obj, ctx);
}

export function isElectricalObject(obj) {
  return designIsElectrical(obj);
}

export function isApplianceObject(obj) {
  const tags = obj?.tags || [];
  const id = String(obj?.library_id || "");
  return tags.includes("appliance") || /^(range|fridge|dw-|micro|wh-|hvac|washer|dryer|disposal)/.test(id);
}

export function findPanel(objects) {
  return findPanelObject(objects);
}

export function homeRunPath(from, to) {
  return designHomeRun(from, to);
}
