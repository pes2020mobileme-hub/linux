import type { Db } from "../database/index.js";

export const XP_COOLDOWN_SEC=60;

export function xpForLevel(level:number){
 if(level<0) throw new Error("level ต้องไม่ต้อนกว่า 0");
 return 100+level*50;
}

export function levelFromXp(totalXp:number){
 let level=0;
 let need=xpForLevel(level);
 let rest=Math.max(0,Math.floor(totalXp));
 while(rest>=need){
  rest-=need;
  level++;
  need=xpForLevel(level);
 }
 return level;
}

export function progressOf(totalXp:number){
 const level=levelFromXp(totalXp);
 const current=Math.max(0,Math.floor(totalXp));
 let used=0;
 for(let l=0;l<level;l++) used+=xpForLevel(l);
 return {level,xpIntoLevel:current-used,xpForNext:xpForLevel(level),percent:Math.round(((current-used)/xpForLevel(level))*100)};
}

export type AddXpResult={ added:boolean; xp:number; level:number; leveledUp:boolean; fromLevel:number; toLevel:number; reason:string };

export function addXp(db:Db,guildId:string,userId:string,amount=1,cooldownSec=XP_COOLDOWN_SEC,now=Date.now()):AddXpResult{
 if(!Number.isInteger(amount)||amount<=0) throw new Error("xp ต้องเป็นจำนวนเต็มที่มากกว่า 0");
 db.prepare("INSERT INTO xp (guild_id, user_id, xp, level, messages) VALUES (?, ?, 0, 0, 0) ON CONFLICT(guild_id, user_id) DO NOTHING").run(guildId,userId);
 const row=db.prepare("SELECT xp, level, messages, last_xp_at FROM xp WHERE guild_id = ? AND user_id = ?").get(guildId,userId) as Record<string,unknown>;
 const lastXpAt=row.last_xp_at?Date.parse(String(row.last_xp_at)):0;
 if(cooldownSec>0&&now-lastXpAt<cooldownSec*1000){
  return {added:false,xp:Number(row.xp),level:Number(row.level),leveledUp:false,fromLevel:Number(row.level),toLevel:Number(row.level),reason:`ยังไม่ถึงเวลารอบ XP (รออีก ${Math.ceil((cooldownSec*1000-(now-lastXpAt))/1000)} วินาที)`};
 }
 const total=Number(row.xp)+amount;
 const level=levelFromXp(total);
 const from=Number(row.level);
 db.prepare("UPDATE xp SET xp = ?, level = ?, messages = messages + 1, last_xp_at = ? WHERE guild_id = ? AND user_id = ?")
  .run(total,level,new Date(now).toISOString(),guildId,userId);
 return {added:true,xp:total,level,leveledUp:level>from,fromLevel:from,toLevel:level,reason:level>from?`เลื่อนเป็นเลเวล ${level}`:`+${amount} XP`};
}

export function rank(db:Db,guildId:string,userId:string){
 const row=db.prepare("SELECT xp, level, messages FROM xp WHERE guild_id = ? AND user_id = ?").get(guildId,userId) as Record<string,unknown>|undefined;
 const total=row?Number(row.xp):0;
 const position=Number((db.prepare("SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND xp > ?").get(guildId,total) as {n:number}).n);
 return {userId,guildId,xp:total,...progressOf(total),messages:row?Number(row.messages):0,rank:position+1};
}

export function leaderboard(db:Db,guildId:string,limit=10){
 return db.prepare("SELECT user_id, xp, level FROM xp WHERE guild_id = ? ORDER BY xp DESC, user_id ASC LIMIT ?")
  .all(guildId,limit)
  .map((r,i)=>{
   const rec=r as Record<string,unknown>;
   return {rank:i+1,userId:String(rec.user_id),xp:Number(rec.xp),level:Number(rec.level)};
  });
}

export function levelRewards(level:number){
 const rewards:string[]=[];
 if(level>=3) rewards.push("role:member-tier1");
 if(level>=6) rewards.push("role:member-tier2");
 if(level>=10) rewards.push("role:member-tier3");
 if(level>=15) rewards.push("role:honored");
 return rewards;
}

export type ShopItem={ id:string; name:string; price:number; roleId?:string };

export function grantLevelRewards(db:Db,guildId:string,userId:string,fromLevel:number,toLevel:number){
 return levelRewards(toLevel).filter(r=>levelRewards(fromLevel).indexOf(r)===-1);
}