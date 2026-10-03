import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type TxKind="credit"|"debit"|"transfer_in"|"transfer_out"|"reward";

export type TxResult={ ok:boolean; balance:number; amount:number; reason:string; txId?:string };

const now=()=>new Date().toISOString();

function ensureAccount(db:Db,userId:string){
 db.prepare("INSERT INTO economy_accounts (user_id, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(user_id) DO NOTHING").run(userId,now());
}

export function balance(db:Db,userId:string){
 const row=db.prepare("SELECT balance FROM economy_accounts WHERE user_id = ?").get(userId) as {balance:number}|undefined;
 return row?Number(row.balance):0;
}

function writeTx(db:Db,userId:string,kind:TxKind,amount:number,balanceAfter:number,reason:string,ref:string|null){
 const id=crypto.randomUUID();
 db.prepare("INSERT INTO economy_transactions (id, user_id, kind, amount, balance_after, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  .run(id,userId,kind,amount,balanceAfter,reason,ref,now());
 return id;
}

export function credit(db:Db,userId:string,amount:number,reason:string,ref:string|null=null):TxResult{
 if(!Number.isInteger(amount)||amount<=0) return {ok:false,balance:balance(db,userId),amount,reason:"จำนวนเครดิตต้องเป็นจำนวนเต็มที่มากกว่า 0"};
 if(ref&&refUsed(db,ref)) return {ok:false,balance:balance(db,userId),amount,reason:`ref ${ref} ถูกใช้ไปแล้ว`};
 db.exec("BEGIN IMMEDIATE");
 try{
  ensureAccount(db,userId);
  const next=balance(db,userId)+amount;
  db.prepare("UPDATE economy_accounts SET balance = ?, lifetime_earned = lifetime_earned + ?, updated_at = ? WHERE user_id = ?").run(next,amount,now(),userId);
  const txId=writeTx(db,userId,"credit",amount,next,reason,ref);
  db.exec("COMMIT");
  return {ok:true,balance:next,amount,reason,txId};
 }catch(e){
  db.exec("ROLLBACK");
  return {ok:false,balance:balance(db,userId),amount,reason:e instanceof Error?e.message:String(e)};
 }
}

export function debit(db:Db,userId:string,amount:number,reason:string,ref:string|null=null):TxResult{
 if(!Number.isInteger(amount)||amount<=0) return {ok:false,balance:balance(db,userId),amount,reason:"จำนวนหักต้องเป็นจำนวนเต็มที่มากกว่า 0"};
 if(ref&&refUsed(db,ref)) return {ok:false,balance:balance(db,userId),amount,reason:`ref ${ref} ถูกใช้ไปแล้ว`};
 db.exec("BEGIN IMMEDIATE");
 try{
  ensureAccount(db,userId);
  const current=balance(db,userId);
  if(current<amount){
   db.exec("ROLLBACK");
   return {ok:false,balance:current,amount,reason:`ยอดคงเหลือไม่พอ (มี ${current} ต้องใช้ ${amount})`};
  }
  const next=current-amount;
  db.prepare("UPDATE economy_accounts SET balance = ?, lifetime_spent = lifetime_spent + ?, updated_at = ? WHERE user_id = ?").run(next,amount,now(),userId);
  const txId=writeTx(db,userId,"debit",amount,next,reason,ref);
  db.exec("COMMIT");
  return {ok:true,balance:next,amount,reason,txId};
 }catch(e){
  db.exec("ROLLBACK");
  return {ok:false,balance:balance(db,userId),amount,reason:e instanceof Error?e.message:String(e)};
 }
}

function refUsed(db:Db,ref:string){
 return db.prepare("SELECT 1 AS x FROM economy_transactions WHERE ref = ?").get(ref)!==undefined;
}

export function transfer(db:Db,fromId:string,toId:string,amount:number,reason="โอน",ref:string|null=null):TxResult{
 if(fromId===toId) return {ok:false,balance:balance(db,fromId),amount,reason:"โอนให้ตัวเองไม่ได้"};
 if(!Number.isInteger(amount)||amount<=0) return {ok:false,balance:balance(db,fromId),amount,reason:"จำนวนต้องเป็นจำนวนเต็มที่มากกว่า 0"};
 if(ref&&refUsed(db,ref)) return {ok:false,balance:balance(db,fromId),amount,reason:`ref ${ref} ถูกใช้ไปแล้ว`};
 db.exec("BEGIN IMMEDIATE");
 try{
  ensureAccount(db,fromId);
  ensureAccount(db,toId);
  const from=balance(db,fromId);
  if(from<amount){
   db.exec("ROLLBACK");
   return {ok:false,balance:from,amount,reason:`ยอดคงเหลือไม่พอ (มี ${from} ต้องใช้ ${amount})`};
  }
  const fromNext=from-amount;
  const toNext=balance(db,toId)+amount;
  db.prepare("UPDATE economy_accounts SET balance = ?, lifetime_spent = lifetime_spent + ?, updated_at = ? WHERE user_id = ?").run(fromNext,amount,now(),fromId);
  db.prepare("UPDATE economy_accounts SET balance = ?, lifetime_earned = lifetime_earned + ?, updated_at = ? WHERE user_id = ?").run(toNext,amount,now(),toId);
  writeTx(db,fromId,"transfer_out",amount,fromNext,reason,ref?`${ref}:out`:null);
  writeTx(db,toId,"transfer_in",amount,toNext,reason,ref?`${ref}:in`:null);
  db.exec("COMMIT");
  return {ok:true,balance:fromNext,amount,reason};
 }catch(e){
  db.exec("ROLLBACK");
  return {ok:false,balance:balance(db,fromId),amount,reason:e instanceof Error?e.message:String(e)};
 }
}

export function statement(db:Db,userId:string,limit=20){
 return db.prepare("SELECT id, kind, amount, balance_after, reason, ref, created_at FROM economy_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
  .all(userId,limit)
  .map(r=>({
   id:String((r as Record<string,unknown>).id),
   kind:String((r as Record<string,unknown>).kind),
   amount:Number((r as Record<string,unknown>).amount),
   balanceAfter:Number((r as Record<string,unknown>).balance_after),
   reason:String((r as Record<string,unknown>).reason),
   ref:(r as Record<string,unknown>).ref?String((r as Record<string,unknown>).ref):null,
   createdAt:String((r as Record<string,unknown>).created_at)
  }));
}

export function accountSummary(db:Db,userId:string){
 const row=db.prepare("SELECT balance, lifetime_earned, lifetime_spent FROM economy_accounts WHERE user_id = ?").get(userId) as Record<string,unknown>|undefined;
 if(!row) return {balance:0,lifetimeEarned:0,lifetimeSpent:0};
 return {balance:Number(row.balance),lifetimeEarned:Number(row.lifetime_earned),lifetimeSpent:Number(row.lifetime_spent)};
}