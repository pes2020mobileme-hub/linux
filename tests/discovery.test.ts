import { test } from "node:test";
import assert from "node:assert/strict";
import { pickGuildId } from "../src/config/discovery.js";

function fakeClient(ids:string[]){
 return { guilds:{ cache:{ keys:()=>ids, size:ids.length } } } as never;
}

test("ใช้ GUILD_ID ที่ตั้งไว้เมื่อมี", ()=>{
 const prev=process.env.GUILD_ID;
 process.env.GUILD_ID="123456789012345678";
 const picked=pickGuildId(fakeClient(["999"]));
 assert.equal(picked.ok,true);
 if(picked.ok){ assert.equal(picked.id,"123456789012345678"); assert.match(picked.how,/GUILD_ID/); }
 if(prev) process.env.GUILD_ID=prev; else delete process.env.GUILD_ID;
});

test("หาเองจาก server เดียวที่บอทอยู่", ()=>{
 const prev=process.env.GUILD_ID;
 delete process.env.GUILD_ID;
 const picked=pickGuildId(fakeClient(["111"]));
 assert.equal(picked.ok,true);
 if(picked.ok){ assert.equal(picked.id,"111"); assert.match(picked.how,/หาเอง/); }
 if(prev) process.env.GUILD_ID=prev;
});

test("ไม่เดาเมื่ออยู่หลาย server — ต้องบอกให้ตั้งค่า", ()=>{
 const prev=process.env.GUILD_ID;
 delete process.env.GUILD_ID;
 const picked=pickGuildId(fakeClient(["111","222"]));
 assert.equal(picked.ok,false);
 if(!picked.ok) assert.match(picked.reason,/ต้องตั้ง GUILD_ID/);
 if(prev) process.env.GUILD_ID=prev;
});

test("บอกชัดเมื่อไม่ได้อยู่ใน server ใดเลย", ()=>{
 const prev=process.env.GUILD_ID;
 delete process.env.GUILD_ID;
 const picked=pickGuildId(fakeClient([]));
 assert.equal(picked.ok,false);
 if(!picked.ok) assert.match(picked.reason,/เชิญบอท/);
 if(prev) process.env.GUILD_ID=prev;
});
