export type RateScope="ip"|"user"|"apikey"|"guild"|"route";

export type RateRule={ limit:number; windowSec:number };

export type RateDecision={ allowed:boolean; remaining:number; limit:number; resetInSec:number; scope:RateScope; key:string };

export const DEFAULT_RULES:Record<RateScope,RateRule>={
 ip:{limit:60,windowSec:60},
 user:{limit:30,windowSec:60},
 apikey:{limit:120,windowSec:60},
 guild:{limit:300,windowSec:60},
 route:{limit:120,windowSec:60}
};

type Hit={ timestamps:number[] };

export class RateLimiter{
 private hits=new Map<string,Hit>();
 private rules:Record<RateScope,RateRule>;
 private now:()=>number;

 constructor(rules:Partial<Record<RateScope,RateRule>>={},now:()=>number=Date.now){
  this.rules={...DEFAULT_RULES,...rules};
  this.now=now;
 }

 private ruleFor(scope:RateScope){
  return this.rules[scope]??DEFAULT_RULES[scope];
 }

 check(scope:RateScope,key:string):RateDecision{
  const rule=this.ruleFor(scope);
  const t=this.now();
  const cutoff=t-rule.windowSec*1000;
  const id=`${scope}:${key}`;
  const bucket=this.hits.get(id)??{timestamps:[]};
  bucket.timestamps=bucket.timestamps.filter(x=>x>cutoff);
  const count=bucket.timestamps.length;
  if(count>=rule.limit){
   const oldest=bucket.timestamps[0]??t;
   this.hits.set(id,bucket);
   return {allowed:false,remaining:0,limit:rule.limit,resetInSec:Math.max(1,Math.ceil((oldest+rule.windowSec*1000-t)/1000)),scope,key};
  }
  bucket.timestamps.push(t);
  this.hits.set(id,bucket);
  return {allowed:true,remaining:rule.limit-count-1,limit:rule.limit,resetInSec:rule.windowSec,scope,key};
 }

 checkAll(subject:{ip?:string;user?:string;apikey?:string;guild?:string;route?:string}){
  const decisions:RateDecision[]=[];
  for(const [scope,key] of Object.entries(subject) as Array<[RateScope,string|undefined]>){
   if(key) decisions.push(this.check(scope,key));
  }
  const blocked=decisions.find(d=>!d.allowed);
  return blocked??decisions[0]??{allowed:true,remaining:0,limit:0,resetInSec:0,scope:"ip",key:""};
 }

 reset(scope?:RateScope,key?:string){
  if(!scope){this.hits.clear();return;}
  if(key){this.hits.delete(`${scope}:${key}`);return;}
  for(const id of [...this.hits.keys()]) if(id.startsWith(`${scope}:`)) this.hits.delete(id);
 }

 size(){
  return this.hits.size;
 }
}

export function retryAfterHeader(d:RateDecision){
 return d.allowed?null:String(d.resetInSec);
}