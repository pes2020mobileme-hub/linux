import { ensureInternalSecrets } from "../setup/secret-manager.js";
import { runDoctor, formatReport, summarize } from "../setup/doctor.js";
import { listFeatures } from "../config/features.js";

async function main(){
 const generated=ensureInternalSecrets();
 if(generated.persisted) console.log(`สร้าง secret ภายใน ${generated.created.length} ตัวแล้ว: ${generated.created.join(", ")} (บันทึกลง .env)`);
 else console.log("internal secrets ครบแล้ว ไม่ต้องสร้างใหม่");

 const checks=runDoctor();
 console.log("");
 console.log(formatReport(checks));

 const s=summarize(checks);
 console.log("");
 console.log("ฟีเจอร์:");
 for(const f of listFeatures()) console.log(`  ${f.enabled?"เปิด ":"ปิด "} ${f.name} (${f.flag}, default ${f.default})`);

 console.log("");
 console.log(s.FAIL>0?"ต้องแก้ FAIL ก่อนบอทจะทำงานครบ":s.WARN>0?"ทำงานได้แต่มีคำเตือน ด้านบน":"ทุกอย่างผ่าน");
 if(s.FAIL>0) process.exitCode=1;
}

main();