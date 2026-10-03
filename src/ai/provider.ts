export type ProviderState="PASS"|"FAIL"|"UNKNOWN";

export type ProviderCheck={ state:ProviderState; detail:string; fix?:string; model?:string; latencyMs:number };

export type FetchLike=(url:string,init:{method:string;headers:Record<string,string>;body:string})=>Promise<{status:number;json:()=>Promise<any>}>;

export const OPENROUTER_BASE="https://openrouter.ai/api/v1";
export const DEFAULT_MODEL="anthropic/claude-sonnet-4";

export async function checkOpenRouter(apiKey:string|undefined,model:string=DEFAULT_MODEL,fetchImpl?:FetchLike):Promise<ProviderCheck>{
 if(!apiKey) return {state:"FAIL",detail:"ไม่ได้ตั้ง OPENROUTER_API_KEY",fix:"ใส่ key หรือตั้ง AI_ENABLED=false",latencyMs:0};
 const doFetch=fetchImpl??(globalThis.fetch as unknown as FetchLike);
 if(!doFetch) return {state:"UNKNOWN",detail:"runtime นี้ไม่มี fetch ให้ใช้",latencyMs:0};
 const started=Date.now();
 let res:{status:number;json:()=>Promise<any>};
 try{
  res=await doFetch(`${OPENROUTER_BASE}/models`,{method:"GET",headers:{authorization:`Bearer ${apiKey}`},body:""});
 }catch(e){
  return {state:"FAIL",detail:`เรียก OpenRouter ไม่สำเร็จ: ${e instanceof Error?e.message:String(e)}`,fix:"ตรวจการเชื่อมต่ออินเทอร์เน็ตของ host",latencyMs:Date.now()-started};
 }
 const latencyMs=Date.now()-started;
 if(res.status===401||res.status===403) return {state:"FAIL",detail:`OpenRouter ไม่ยอมรับ key (${res.status})`,fix:"ตรวจว่า OPENROUTER_API_KEY ถูกต้องและยังไม่หมดอายุ",latencyMs};
 if(res.status===429) return {state:"FAIL",detail:"OpenRouter จำกัดอัตราการเรียก (429)",fix:"ลองใหม่ภายหลัง หรือเติมเครดิต",latencyMs};
 if(res.status<200||res.status>=300) return {state:"FAIL",detail:`OpenRouter ตอบกลับ HTTP ${res.status}`,fix:"ดูสถานะของผู้ให้บริการ",latencyMs};
 const data=await res.json().catch(()=>null);
 const count=Array.isArray(data?.data)?data.data.length:0;
 if(!count) return {state:"UNKNOWN",detail:"ต่อ OpenRouter ได้แต่ไม่มีรายการ model กลับมา",latencyMs};
 const exists=Array.isArray(data.data)&&data.data.some((m:Record<string,unknown>)=>String(m.id)===model);
 return {
  state:"PASS",
  detail:`ต่อได้ · ${count} models · ${latencyMs}ms${exists?"":` · ยังไม่เห็น model "${model}" ในรายการ (ใช้ตัวนี้ไม่ได้จนกว่าจะเปิดสิทธิ์)`}`,
  fix:exists?undefined:"เปลี่ยน OPENROUTER_MODEL เป็น model ที่บัญชีคุณใช้ได้",
  model,
  latencyMs
 };
}
