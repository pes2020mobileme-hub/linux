export type FeatureName=
 "AI"|"MUSIC"|"ANTI_RAID"|"ECONOMY"|"XP"|"TICKETS"|"GIVEAWAY"|"POLL"|"WEBHOOK"|"API"|"PLUGINS"|"BACKUP"|"DASHBOARD";

const DEFAULTS:Record<FeatureName,boolean>={
 AI:true,
 MUSIC:false,
 ANTI_RAID:true,
 ECONOMY:false,
 XP:false,
 TICKETS:false,
 GIVEAWAY:false,
 POLL:false,
 WEBHOOK:false,
 API:false,
 PLUGINS:false,
 BACKUP:false,
 DASHBOARD:false
};

export const FEATURE_NAMES=Object.keys(DEFAULTS) as FeatureName[];

function readFlag(name:FeatureName,env:NodeJS.ProcessEnv){
 const raw=(env[`${name}_ENABLED`]??"").trim().toLowerCase();
 if(raw==="true"||raw==="1") return true;
 if(raw==="false"||raw==="0") return false;
 return DEFAULTS[name];
}

export function listFeatures(env:NodeJS.ProcessEnv=process.env){
 return FEATURE_NAMES.map(name=>({name,enabled:readFlag(name,env),flag:`${name}_ENABLED`,default:DEFAULTS[name]}));
}

export function isEnabled(name:FeatureName,env:NodeJS.ProcessEnv=process.env){
 return readFlag(name,env);
}

export function describeFlags(){
 return FEATURE_NAMES.map(n=>`${n}_ENABLED (default: ${DEFAULTS[n]?"true":"false"})`).join(", ");
}