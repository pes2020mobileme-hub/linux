import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOpenRouter, DEFAULT_MODEL } from "../src/ai/provider.js";

function fakeFetch(status:number,body:unknown){
 return async()=>({status,json:async()=>body});
}

test("ไม่มี key ต้อง FAIL พร้อมวิธีแก้", async ()=>{
 const r=await checkOpenRouter(undefined);
 assert.equal(r.state,"FAIL");
 assert.match(r.detail,/ไม่ได้ตั้ง/);
 assert.match(r.fix?? "",/AI_ENABLED/);
});

test("key ผิดได้ 401/403 ต้อง FAIL และบอกว่า key ไม่ถูกต้อง", async ()=>{
 const r=await checkOpenRouter("bad",DEFAULT_MODEL,fakeFetch(401,{}));
 assert.equal(r.state,"FAIL");
 assert.match(r.detail,/401/);
 assert.match(r.fix?? "",/OPENROUTER_API_KEY/);
});

test("429 ต้องรายงานว่าโดนจำกัดอัตรา", async ()=>{
 const r=await checkOpenRouter("k",DEFAULT_MODEL,fakeFetch(429,{}));
 assert.equal(r.state,"FAIL");
 assert.match(r.detail,/429/);
});

test("ต่อได้แต่ไม่มีรายการ model ต้อง UNKNOWN ไม่ใช่ PASS", async ()=>{
 const r=await checkOpenRouter("k",DEFAULT_MODEL,fakeFetch(200,{}));
 assert.equal(r.state,"UNKNOWN");
});

test("ต่อได้และมี model ตรงกับที่ตั้งไว้ ต้อง PASS", async ()=>{
 const body={data:[{id:"openai/gpt-4o"},{id:DEFAULT_MODEL}]};
 const r=await checkOpenRouter("k",DEFAULT_MODEL,fakeFetch(200,body));
 assert.equal(r.state,"PASS");
 assert.match(r.detail,/2 models/);
 assert.equal(r.fix,undefined);
});

test("ต่อได้แต่ model ที่ตั้งไว้ไม่มีในรายการ ต้องเตือนให้เปลี่ยน", async ()=>{
 const body={data:[{id:"openai/gpt-4o"}]};
 const r=await checkOpenRouter("k","some/unavailable-model",fakeFetch(200,body));
 assert.equal(r.state,"PASS");
 assert.match(r.detail,/ยังไม่เห็น model/);
 assert.match(r.fix?? "",/OPENROUTER_MODEL/);
});

test("5xx ต้อง FAIL ไม่ใช่ผ่านเงียบๆ", async ()=>{
 const r=await checkOpenRouter("k",DEFAULT_MODEL,fakeFetch(503,{}));
 assert.equal(r.state,"FAIL");
 assert.match(r.detail,/503/);
});

test("network error ต้อง FAIL พร้อมข้อความ error จริง", async ()=>{
 const throwing=async()=>{throw new Error("ENOTFOUND openrouter.ai");};
 const r=await checkOpenRouter("k",DEFAULT_MODEL,throwing as never);
 assert.equal(r.state,"FAIL");
 assert.match(r.detail,/ENOTFOUND/);
});

test("วัด latency จริงเป็นมิลลิวินาที ไม่ใช่ค่าปลอม", async ()=>{
 const slow=async()=>{
  await new Promise(r=>setTimeout(r,30));
  return {status:200,json:async()=>({data:[{id:DEFAULT_MODEL}]})};
 };
 const r=await checkOpenRouter("k",DEFAULT_MODEL,slow);
 assert.equal(r.state,"PASS");
 assert.ok(r.latencyMs>=25,`ควรวัดได้จริง ได้ ${r.latencyMs}ms`);
});
