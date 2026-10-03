export type RaidEventKind=
 "mass_join"|"mass_leave"|"mass_ban"|"mass_kick"|"mass_channel_delete"|
 "mass_role_delete"|"mass_channel_create"|"mass_role_create"|"webhook_spam"|"mention_spam"|"invite_spam";

export type RaidLevel="NORMAL"|"SUSPICIOUS"|"RAID"|"LOCKDOWN";

export type RaidConfig={
 windowSec:number;
 suspicious:number;
 raid:number;
 lockdown:number;
 actionThreshold:number;
};

export const DEFAULT_RAID_CONFIG:RaidConfig={windowSec:10,suspicious:5,raid:10,lockdown:20,actionThreshold:10};

export type RaidVerdict={
 level:RaidLevel;
 count:number;
 kind:RaidEventKind;
 guildId:string;
 windowSec:number;
 shouldAct:boolean;
 reason:string;
};

export type Recorder=(verdict:RaidVerdict)=>void;

type Bucket={ timestamps:number[]; level:RaidLevel };

export class RaidDetector{
 private buckets=new Map<string,Bucket>();
 private config:RaidConfig;
 private recorder:Recorder;

 constructor(config:Partial<RaidConfig>={},recorder?:Recorder){
  this.config={...DEFAULT_RAID_CONFIG,...config};
  if(this.config.suspicious>=this.config.raid||this.config.raid>=this.config.lockdown)
   throw new Error("threshold ของ anti-raid ต้องเรียงจากน้อยไปมาก: suspicious < raid < lockdown");
  this.recorder=recorder??(()=>{});
 }

 private bucket(guildId:string,kind:RaidEventKind,now:number){
  const key=`${guildId}:${kind}`;
  const cutoff=now-this.config.windowSec*1000;
  let b=this.buckets.get(key);
  if(!b){b={timestamps:[],level:"NORMAL"};this.buckets.set(key,b);}
  b.timestamps=b.timestamps.filter(t=>t>cutoff);
  b.timestamps.push(now);
  return b;
 }

 record(guildId:string,kind:RaidEventKind,amount=1,now=Date.now()):RaidVerdict{
  const b=this.bucket(guildId,kind,now);
  for(let i=0;i<amount-1;i++) b.timestamps.push(now);
  const count=b.timestamps.length;
  const level:RaidLevel=count>=this.config.lockdown?"LOCKDOWN"
   :count>=this.config.raid?"RAID"
   :count>=this.config.suspicious?"SUSPICIOUS"
   :"NORMAL";
  if(this.config.windowSec*1000<=0) throw new Error("windowSec ต้องมากกว่า 0");
  b.level=level;
  const verdict:RaidVerdict={
   level,count,kind,guildId,
   windowSec:this.config.windowSec,
   shouldAct:level!=="NORMAL"&&count>=this.config.actionThreshold,
   reason:level==="NORMAL"?`ต่ำกว่าเกณฑ์ (${count}/${this.config.suspicious})`:`${kind} ${count} ครั้งใน ${this.config.windowSec} วินาที เกินเกณฑ์ ${this.config.suspicious}`
  };
  this.recorder(verdict);
  return verdict;
 }

 levelOf(guildId:string,kind:RaidEventKind):RaidLevel{
  return this.buckets.get(`${guildId}:${kind}`)?.level??"NORMAL";
 }

 openIncidents(guildId:string){
  const out:Array<{kind:RaidEventKind;level:RaidLevel}>=[];
  for(const [key,b] of this.buckets){
   if(!key.startsWith(`${guildId}:`)||b.level==="NORMAL") continue;
   out.push({kind:key.slice(guildId.length+1) as RaidEventKind,level:b.level});
  }
  return out;
 }

 reset(guildId?:string){
  if(!guildId){this.buckets.clear();return;}
  for(const key of [...this.buckets.keys()]) if(key.startsWith(`${guildId}:`)) this.buckets.delete(key);
 }

 config_():RaidConfig{
  return {...this.config};
 }
}