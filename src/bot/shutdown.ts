export type ShutdownStep={ name:string; run:()=>Promise<void>|void };

export function installShutdown(steps:ShutdownStep[]){
 let running=false;
 const shutdown=async(signal:string)=>{
  if(running){console.log(`${signal} ซ้ำ — กำลังปิดอยู่แล้ว ไม่ทำซ้ำ`);return;}
  running=true;
  console.log(`\n${signal} ได้รับ — เริ่มปิดระบบอย่างเป็นระบบ (${steps.length} ขั้นตอน)`);
  for(const s of steps){
   try{
    await s.run();
    console.log(`✓ ${s.name}`);
   }catch(e){
    console.error(`✗ ${s.name}: ${e instanceof Error?e.message:String(e)}`);
   }
  }
  console.log("ปิดระบบเรียบร้อย");
  process.exit(0);
 };
 process.on("SIGTERM",()=>void shutdown("SIGTERM"));
 process.on("SIGINT",()=>void shutdown("SIGINT"));
 return shutdown;
}