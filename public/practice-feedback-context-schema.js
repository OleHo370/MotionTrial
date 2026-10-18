// A small wording-only annotation. Camera samples and landmarks stay local.
const aliases={15:33,16:34,27:35,28:36,33:33,34:34,35:35,36:36};
const directions=new Set(['up','down','left','right','hold','mixed']);
const observedDirections=new Set(['up','down','left','right']);
export function normalizePracticeFeedbackContext(value,issues=[]){
  if(!value||value.version!=='practice-feedback-context-v1'||!Array.isArray(value.limbs)
    ||value.limbs.length>4)return null;
  const limbs=[],seen=new Set();
  for(const limb of value.limbs){
    if(!limb||![33,34,35,36].includes(limb.index)||seen.has(limb.index)
      ||!directions.has(limb.expectedDirection))return null;
    seen.add(limb.index);
    const entry={index:limb.index,expectedDirection:limb.expectedDirection};
    if(limb.observedDirection!==undefined){
      if(!observedDirections.has(limb.observedDirection)
        ||!issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='off_guide')
        ||issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='tracking_unknown'))return null;
      entry.observedDirection=limb.observedDirection;
    }
    limbs.push(entry);
  }
  const context={version:value.version,limbs};
  if(value.practiceFocus!==undefined){
    if(!['coordination','range'].includes(value.practiceFocus))return null;
    const held=limbs.filter(limb=>limb.expectedDirection==='hold'
      &&issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='hold_drift')
      &&!issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='tracking_unknown'));
    const moving=limbs.filter(limb=>limb.expectedDirection!=='hold'
      &&!issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='tracking_unknown'));
    const supported=value.practiceFocus==='coordination'
      ?held.some(hold=>moving.some(move=>(hold.index<=34)!==(move.index<=34)))
      :limbs.some(limb=>limb.index<=34&&limb.expectedDirection!=='hold'
        &&issues.some(issue=>aliases[issue.index]===limb.index
          &&['movement_incomplete','endpoint_unreached'].includes(issue.code))
        &&!issues.some(issue=>aliases[issue.index]===limb.index&&issue.code==='tracking_unknown'));
    if(!supported)return null;
    context.practiceFocus=value.practiceFocus;
  }
  return context;
}
