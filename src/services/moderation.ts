import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type ModAction="warn"|"timeout"|"mute"|"kick"|"ban"|"unban"|"purge"|"slowmode"|"lock"|"unlock";

export const MOD_ACTIONS:ModAction[]=["warn","timeout","mute","kick","ban","unban","purge","slowmode","lock","unlock"];

export type ModCase={
 caseId:string; guildId:string; moderatorId:string; userId:string;
 action:ModAction; reason:string; evidence:string|null; durationSec:number|null; createdAt:string;
};

function toCase(r:Record<string,unknown>):ModCase{
 return {
  caseId:String(r.case_id),guildId:String(r.guild_id),moderatorId:String(r.moderator_id),userId:String(r.user_id),
  action:String(r.action) as ModAction,reason:String(r.reason),
  evidence:r.evidence?String(r.evidence):null,
  durationSec:r.duration_sec===null||r.duration_sec===undefined?null:Number(r.duration_sec),
  createdAt:String(r.created_at)
 };
}

export type CreateCaseInput={ guildId:string; moderatorId:string; userId:string; action:ModAction; reason:string; evidence?:string; durationSec?:number };

export function createCase(db:Db,input:CreateCaseInput):ModCase{
 if(!MOD_ACTIONS.includes(input.action)) throw new Error(`action ไม่ถูกต้อง: ${input.action}`);
 if(!input.reason||!input.reason.trim()) throw new Error("ต้องระบุเหตุผลของการลงโทษ");
 if((input.action==="timeout")&&(!Number.isInteger(input.durationSec)||(input.durationSec??0)<=0))
  throw new Error("timeout ต้องระบุระยะเวลาเป็นจำนวนเต็มมากกว่า 0 วินาที");
 if((input.action==="slowmode")&&(!Number.isInteger(input.durationSec)||(input.durationSec??0)<0))
  throw new Error("slowmode ต้องระบุระยะเวลาเป็นจำนวนเต็มที่ไม่ติดลบ");
 const caseId=crypto.randomUUID();
 const createdAt=new Date().toISOString();
 db.prepare("INSERT INTO moderation_cases (case_id, guild_id, moderator_id, user_id, action, reason, evidence, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .run(caseId,input.guildId,input.moderatorId,input.userId,input.action,input.reason.trim(),input.evidence??null,input.durationSec??null,createdAt);
 return {caseId,guildId:input.guildId,moderatorId:input.moderatorId,userId:input.userId,action:input.action,reason:input.reason.trim(),evidence:input.evidence??null,durationSec:input.durationSec??null,createdAt};
}

export function listCases(db:Db,guildId:string,limit=20){
 return db.prepare("SELECT * FROM moderation_cases WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?")
  .all(guildId,limit).map(r=>toCase(r as Record<string,unknown>));
}

export function casesForUser(db:Db,guildId:string,userId:string,limit=20){
 return db.prepare("SELECT * FROM moderation_cases WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?")
  .all(guildId,userId,limit).map(r=>toCase(r as Record<string,unknown>));
}

export function warningCount(db:Db,guildId:string,userId:string){
 return Number((db.prepare("SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id = ? AND user_id = ? AND action = 'warn'").get(guildId,userId) as {n:number}).n);
}

export function caseStats(db:Db,guildId:string){
 const rows=db.prepare("SELECT action, COUNT(*) AS n FROM moderation_cases WHERE guild_id = ? GROUP BY action ORDER BY n DESC").all(guildId) as Array<Record<string,unknown>>;
 return rows.map(r=>({action:String(r.action),count:Number(r.n)}));
}

export function revokeCase(db:Db,caseId:string){
 db.prepare("UPDATE moderation_cases SET active = 0 WHERE case_id = ?").run(caseId);
 return Number(db.prepare("SELECT changes() AS c").get()?.c??0)>0;
}

export type Escalation={ tier:"none"|"watch"|"restrict"|"remove"; reason:string; warnings:number };

export function escalationFor(warnings:number,thresholds:Record<string,number>={watch:3,restrict:5,remove:8}):Escalation{
 if(warnings>=thresholds.remove) return {tier:"remove",reason:`มีคำเตือน ${warnings} ครั้ง ถึงเกณฑ์ขั้นที่ ${thresholds.remove}`,warnings};
 if(warnings>=thresholds.restrict) return {tier:"restrict",reason:`มีคำเตือน ${warnings} ครั้ง ถึงเกณฑ์ขั้นที่ ${thresholds.restrict}`,warnings};
 if(warnings>=thresholds.watch) return {tier:"watch",reason:`มีคำเตือน ${warnings} ครั้ง ถึงเกณฑ์ขั้นที่ ${thresholds.watch}`,warnings};
 return {tier:"none",reason:`มีคำเตือน ${warnings} ครั้ง ยังไม่ถึงเกณฑ์`,warnings};
}