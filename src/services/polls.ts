import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type Poll={
 id:string; guildId:string; channelId:string|null; question:string; options:string[];
 multiple:boolean; anonymous:boolean; endsAt:string; createdBy:string; createdAt:string; closed:boolean;
};

export type VoteResult={ ok:boolean; reason:string; poll?:Poll };

const now=()=>new Date().toISOString();

function toPoll(r:Record<string,unknown>):Poll{
 return {
  id:String(r.id),guildId:String(r.guild_id),channelId:r.channel_id?String(r.channel_id):null,
  question:String(r.question),options:JSON.parse(String(r.options)) as string[],
  multiple:Number(r.multiple)===1,anonymous:Number(r.anonymous)===1,
  endsAt:String(r.ends_at),createdBy:String(r.created_by),createdAt:String(r.created_at),closed:Number(r.closed)===1
 };
}

export type CreatePollInput={ guildId:string; channelId?:string|null; question:string; options:string[]; durationSec:number; multiple?:boolean; anonymous?:boolean; createdBy:string };

export function createPoll(db:Db,input:CreatePollInput):Poll{
 const options=input.options.map(o=>o.trim()).filter(Boolean);
 if(!input.question.trim()) throw new Error("ต้องระบุคำถาม");
 if(options.length<2) throw new Error("ต้องมีอย่างน้อย 2 ตัวเลือก");
 if(options.length>10) throw new Error("มีได้ไม่เกิน 10 ตัวเลือก");
 if(new Set(options).size!==options.length) throw new Error("ตัวเลือกต้องไม่ซ้ำกัน");
 if(!Number.isInteger(input.durationSec)||input.durationSec<=0) throw new Error("durationSec ต้องเป็นจำนวนเต็มมากกว่า 0");
 const id=crypto.randomUUID();
 const endsAt=new Date(Date.now()+input.durationSec*1000).toISOString();
 const createdAt=now();
 db.prepare("INSERT INTO polls (id, guild_id, channel_id, question, options, multiple, anonymous, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .run(id,input.guildId,input.channelId??null,input.question.trim(),JSON.stringify(options),input.multiple?1:0,input.anonymous?1:0,endsAt,input.createdBy,createdAt);
 return {id,guildId:input.guildId,channelId:input.channelId??null,question:input.question.trim(),options,multiple:!!input.multiple,anonymous:!!input.anonymous,endsAt,createdBy:input.createdBy,createdAt,closed:false};
}

export function getPoll(db:Db,id:string){
 const row=db.prepare("SELECT * FROM polls WHERE id = ?").get(id) as Record<string,unknown>|undefined;
 return row?toPoll(row):null;
}

function isClosed(poll:Poll,at=Date.now()){
 return poll.closed||Date.parse(poll.endsAt)<=at;
}

export function vote(db:Db,pollId:string,voterId:string,optionIndex:number,at=Date.now()):VoteResult{
 const poll=getPoll(db,pollId);
 if(!poll) return {ok:false,reason:"ไม่พบ poll นี้"};
 if(isClosed(poll,at)) return {ok:false,reason:"ปิดการลงคะแนนแล้ว",poll};
 if(!Number.isInteger(optionIndex)||optionIndex<0||optionIndex>=poll.options.length) return {ok:false,reason:"ตัวเลือกไม่ถูกต้อง",poll};
 const existing=db.prepare("SELECT option_index FROM poll_votes WHERE poll_id = ? AND voter_id = ?").get(pollId,voterId) as {option_index:number}|undefined;
 if(!poll.multiple){
  if(existing){
   if(Number(existing.option_index)===optionIndex) return {ok:true,reason:"ลงคะแนนซ้ำตัวเดิม",poll};
   db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND voter_id = ?").run(pollId,voterId);
   db.prepare("INSERT INTO poll_votes (poll_id, voter_id, option_index, created_at) VALUES (?, ?, ?, ?)").run(pollId,voterId,optionIndex,now());
   return {ok:true,reason:"เปลี่ยนคะแนนแล้ว",poll};
  }
  db.prepare("INSERT INTO poll_votes (poll_id, voter_id, option_index, created_at) VALUES (?, ?, ?, ?)").run(pollId,voterId,optionIndex,now());
  return {ok:true,reason:"ลงคะแนนแล้ว",poll};
 }
 const row=db.prepare("SELECT 1 AS x FROM poll_votes WHERE poll_id = ? AND voter_id = ? AND option_index = ?").get(pollId,voterId,optionIndex);
 if(row) return {ok:true,reason:"ลงคะแนนซ้ำตัวเดิม",poll};
 db.prepare("INSERT INTO poll_votes (poll_id, voter_id, option_index, created_at) VALUES (?, ?, ?, ?)").run(pollId,voterId,optionIndex,now());
 return {ok:true,reason:"ลงคะแนนแล้ว",poll};
}

export type Tally={ options:{index:number; label:string; votes:number; percent:number}[]; totalVotes:number; closed:boolean };

export function tally(db:Db,pollId:string):Tally|null{
 const poll=getPoll(db,pollId);
 if(!poll) return null;
 const counts=new Array(poll.options.length).fill(0) as number[];
 const rows=db.prepare("SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_index").all(pollId) as Array<Record<string,unknown>>;
 for(const r of rows){
  const i=Number(r.option_index);
  if(i>=0&&i<counts.length) counts[i]=Number(r.n);
 }
 const total=counts.reduce((a,b)=>a+b,0);
 return {
  totalVotes:total,
  closed:isClosed(poll),
  options:poll.options.map((label,i)=>({index:i,label,votes:counts[i],percent:total?Math.round((counts[i]/total)*100):0}))
 };
}

export function closePoll(db:Db,pollId:string){
 db.prepare("UPDATE polls SET closed = 1 WHERE id = ?").run(pollId);
 return getPoll(db,pollId);
}

export function listPolls(db:Db,guildId:string,limit=20){
 return db.prepare("SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId,limit).map(r=>toPoll(r as Record<string,unknown>));
}

export function voterCount(db:Db,pollId:string){
 return Number((db.prepare("SELECT COUNT(DISTINCT voter_id) AS n FROM poll_votes WHERE poll_id = ?").get(pollId) as {n:number}).n);
}

export function hasVoted(db:Db,pollId:string,voterId:string){
 return db.prepare("SELECT 1 AS x FROM poll_votes WHERE poll_id = ? AND voter_id = ?").get(pollId,voterId)!==undefined;
}
