import type { Db } from "../database/index.js";

export type StepStatus="PENDING"|"RUNNING"|"PASS"|"WARN"|"FAIL"|"SKIP"|"UNKNOWN";

export type StepResult={ id:string; label:string; status:StepStatus; detail:string; fix?:string; durationMs:number };

export type SetupContext={
 env:NodeJS.ProcessEnv;
 db?:Db;
 guildId?:string;
 clientId?:string;
 state:Record<string,unknown>;
};

export type SetupStep={
 id:string;
 label:string;
 required?:boolean;
 run:(ctx:SetupContext)=>Promise<StepResult>|StepResult;
};

export type SetupReport={
 startedAt:string;
 finishedAt:string;
 results:StepResult[];
 summary:Record<StepStatus,number>;
 ready:boolean;
 blockedBy:string[];
};

const ok=(id:string,label:string,detail:string,status:StepStatus="PASS",fix?:string):StepResult=>({id,label,status,detail,fix,durationMs:0});

export { ok as stepResult };

function summarize(results:StepResult[]){
 const summary:Record<StepStatus,number>={PENDING:0,RUNNING:0,PASS:0,WARN:0,FAIL:0,SKIP:0,UNKNOWN:0};
 for(const r of results) summary[r.status]++;
 return summary;
}

export async function runSetup(steps:SetupStep[],ctx:SetupContext,persist?:Db):Promise<SetupReport>{
 const startedAt=new Date().toISOString();
 const results:StepResult[]=[];
 const blockedBy:string[]=[];
 const runId=`setup_${Date.now().toString(36)}`;

 if(persist) persist.prepare("INSERT INTO setup_state (id, status, started_at) VALUES (?, ?, ?)")
  .run(runId,"RUNNING",startedAt);

 for(const step of steps){
  const t0=Date.now();
  if(blockedBy.length&&step.required){
   results.push({id:step.id,label:step.label,status:"SKIP",detail:`ข้ามเพราะขั้นก่อนหน้าล้มเหลว: ${blockedBy.join(", ")}`,durationMs:0});
   continue;
  }
  let result:StepResult;
  try{
   result=await step.run(ctx);
  }catch(e){
   result={id:step.id,label:step.label,status:"FAIL",detail:e instanceof Error?e.message:String(e),fix:"ดูรายละเอียดใน log แล้วแก้ต้นเหตุ",durationMs:Date.now()-t0};
  }
  result.durationMs=Date.now()-t0;
  results.push(result);
  if(result.status==="FAIL"&&step.required) blockedBy.push(step.label);
 }

 const finishedAt=new Date().toISOString();
 const report:SetupReport={startedAt,finishedAt,results,summary:summarize(results),ready:blockedBy.length===0,blockedBy};

 if(persist){
  persist.prepare("UPDATE setup_state SET status = ?, finished_at = ?, results = ? WHERE id = ?")
   .run(report.ready?"READY":"BLOCKED",finishedAt,JSON.stringify(results),runId);
 }
 return report;
}

export function saveSetupResult(db:Db,report:SetupReport){
 db.prepare("INSERT INTO setup_state (id, status, started_at, finished_at, results) VALUES (?, ?, ?, ?, ?)")
  .run(`setup_${Date.now().toString(36)}`,report.ready?"READY":"BLOCKED",report.startedAt,report.finishedAt,JSON.stringify(report.results));
}

export function lastSetupResult(db:Db){
 const row=db.prepare("SELECT id, status, started_at, finished_at, results FROM setup_state ORDER BY started_at DESC LIMIT 1").get() as Record<string,unknown>|undefined;
 if(!row) return null;
 return {id:String(row.id),status:String(row.status),startedAt:String(row.started_at),finishedAt:row.finished_at?String(row.finished_at):null,results:JSON.parse(String(row.results)) as StepResult[]};
}