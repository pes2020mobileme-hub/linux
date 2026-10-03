import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type TicketStatus="open"|"claimed"|"closed";
export type Ticket={ id:string; guildId:string; channelId:string|null; userId:string; subject:string; status:TicketStatus; claimedBy:string|null; createdAt:string; closedAt:string|null };

const now=()=>new Date().toISOString();

function toTicket(r:Record<string,unknown>):Ticket{
 return {
  id:String(r.id),guildId:String(r.guild_id),channelId:r.channel_id?String(r.channel_id):null,
  userId:String(r.user_id),subject:String(r.subject),status:String(r.status) as TicketStatus,
  claimedBy:r.claimed_by?String(r.claimed_by):null,createdAt:String(r.created_at),closedAt:r.closed_at?String(r.closed_at):null
 };
}

export type CreateTicketInput={ guildId:string; channelId?:string|null; userId:string; subject:string; limitPerUser?:number };

export function createTicket(db:Db,input:CreateTicketInput):Ticket{
 if(!input.subject.trim()) throw new Error("ต้องระบุหัวข้อ");
 const limit=input.limitPerUser??3;
 const open=Number((db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND user_id = ? AND status != 'closed'").get(input.guildId,input.userId) as {n:number}).n);
 if(open>=limit) throw new Error(`เปิด ticket ได้ไม่เกิน ${limit} อันพร้อมกัน (ตอนนี้เปิดอยู่ ${open})`);
 const id=crypto.randomUUID();
 const createdAt=now();
 db.prepare("INSERT INTO tickets (id, guild_id, channel_id, user_id, subject, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)")
  .run(id,input.guildId,input.channelId??null,input.userId,input.subject.trim(),createdAt);
 return {id,guildId:input.guildId,channelId:input.channelId??null,userId:input.userId,subject:input.subject.trim(),status:"open",claimedBy:null,createdAt,closedAt:null};
}

export function getTicket(db:Db,id:string){
 const row=db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Record<string,unknown>|undefined;
 return row?toTicket(row):null;
}

export function claimTicket(db:Db,id:string,staffId:string):Ticket{
 const t=getTicket(db,id);
 if(!t) throw new Error("ไม่พบ ticket นี้");
 if(t.status==="closed") throw new Error("ticket นี้ปิดแล้ว");
 if(t.claimedBy&&t.claimedBy!==staffId) throw new Error("ticket นี้ถูกรับไปแล้ว");
 db.prepare("UPDATE tickets SET status = 'claimed', claimed_by = ? WHERE id = ?").run(staffId,id);
 return getTicket(db,id)!;
}

export function closeTicket(db:Db,id:string){
 db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(now(),id);
 return getTicket(db,id)!;
}

export function reopenTicket(db:Db,id:string){
 const t=getTicket(db,id);
 if(!t) throw new Error("ไม่พบ ticket นี้");
 db.prepare("UPDATE tickets SET status = 'open', claimed_by = NULL, closed_at = NULL WHERE id = ?").run(id);
 return getTicket(db,id)!;
}

export function listTickets(db:Db,guildId:string,status?:TicketStatus,limit=50){
 if(status) return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?").all(guildId,status,limit).map(r=>toTicket(r as Record<string,unknown>));
 return db.prepare("SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId,limit).map(r=>toTicket(r as Record<string,unknown>));
}

export function ticketOwner(db:Db,id:string){
 const t=getTicket(db,id);
 if(!t) throw new Error("ไม่พบ ticket นี้");
 return t.userId;
}

export type AutoCloseReport={ closed:string[]; freedSlots:number };

export function autoCloseIdle(db:Db,guildId:string,idleMin:number,at=Date.now()):AutoCloseReport{
 if(!Number.isInteger(idleMin)||idleMin<=0) throw new Error("idleMin ต้องเป็นจำนวนเต็มมากกว่า 0");
 const cutoff=new Date(at-idleMin*60000).toISOString();
 const rows=db.prepare("SELECT id FROM tickets WHERE guild_id = ? AND status != 'closed' AND last_activity_at IS NOT NULL AND last_activity_at < ?").all(guildId,cutoff) as Array<Record<string,unknown>>;
 const closed:string[]=[];
 for(const r of rows){
  const id=String(r.id);
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(new Date(at).toISOString(),id);
  closed.push(id);
 }
 return {closed,freedSlots:closed.length};
}

export function touchTicket(db:Db,id:string){
 db.prepare("UPDATE tickets SET last_activity_at = ? WHERE id = ?").run(now(),id);
}

export function ticketStats(db:Db,guildId:string){
 const rows=db.prepare("SELECT status, COUNT(*) AS n FROM tickets WHERE guild_id = ? GROUP BY status").all(guildId) as Array<Record<string,unknown>>;
 return Object.fromEntries(rows.map(r=>[String(r.status),Number(r.n)])) as Record<TicketStatus,number>;
}
