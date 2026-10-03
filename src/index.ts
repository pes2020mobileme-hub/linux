import "dotenv/config";
import { Client, Events, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, GuildMember } from "discord.js";
import type { Interaction } from "discord.js";
import { loadUsers, saveUsers, getActiveServer, addServer, listServers, useServer, deleteServer, getState } from "./storage.js";
import { runCommand } from "./linux.js";
import { terminalEmbed, terminalButtons, fileButtons, commandModal, serverListEmbed, serverInfo } from "./ui.js";
import { formatReport } from "./setup/doctor.js";
import { openDatabase, type Db } from "./database/index.js";
import { startHealthServer } from "./api/health.js";
import { installShutdown } from "./bot/shutdown.js";
import { runSetup } from "./setup/setup-engine.js";
import { buildBootSteps } from "./setup/boot-steps.js";
import type { SetupContext, StepResult } from "./setup/setup-engine.js";

const ADMIN_ROLE_ID=process.env.ADMIN_ROLE_ID;
const LOCKED=["terminal","files"];

function isAdmin(i:Interaction){
 if(!ADMIN_ROLE_ID) return true;
 const m=i.member instanceof GuildMember?i.member:null;
 if(!m) return false;
 if(m.permissions.has(PermissionFlagsBits.Administrator)) return true;
 return m.roles.cache.has(ADMIN_ROLE_ID);
}

const ICON:Record<string,string>={PASS:"✓",WARN:"!",FAIL:"✗",UNKNOWN:"?",SKIP:"-"};

function printReport(results:StepResult[]){
 for(const r of results){
  console.log(`${ICON[r.status]??"?"} ${r.label}: ${r.detail}`);
  if(r.fix&&r.status!=="PASS") console.log(`    แก้: ${r.fix}`);
 }
}

function registerHandlers(client:Client){
 client.on(Events.InteractionCreate,async i=>{
  if(!i.isRepliable()) return;
  const needAccess=i.isChatInputCommand()?LOCKED.includes(i.commandName):i.isButton()||i.isModalSubmit();
  if(needAccess&&!isAdmin(i)) {
   await i.reply({content:"❌ ต้องมีสิทธิ์ ADMIN จึงจะใช้คำสั่งนี้ได้",ephemeral:true});
   return;
  }
  try {
   if(i.isChatInputCommand()) {
    const name=i.commandName;
    if(name==="server") {
     const sub=i.options.getSubcommand();
     if(sub==="create") {
      const s=addServer(i.user.id,i.options.getString("name",true));
      await i.reply({embeds:[serverInfo(i.user.id)],content:`✓ Created **${s.name}** and selected it.`});
     } else if(sub==="list") await i.reply({embeds:[serverListEmbed(i.user.id)]});
     else if(sub==="use") { const s=useServer(i.user.id,i.options.getString("name",true)); await i.reply({content:`✓ Active server: **${s.name}**`,embeds:[serverInfo(i.user.id)]}); }
     else if(sub==="delete") { deleteServer(i.user.id,i.options.getString("name",true)); await i.reply({content:"✓ Server deleted"}); }
     else if(sub==="info") await i.reply({embeds:[serverInfo(i.user.id)]});
     return;
    }
    if(name==="terminal") {
     let s; try{s=getActiveServer(i.user.id)}catch{await i.reply({content:"สร้าง server ก่อน: `/server create name`",ephemeral:true});return;}
     const cmd=i.options.getString("command");
     if(cmd) await i.reply({embeds:[terminalEmbed(s,runCommand(s,cmd),cmd)],components:[terminalButtons()]});
     else await i.reply({embeds:[terminalEmbed(s,"Virtual Linux ready. กด Enter Command เพื่อเริ่ม","")],components:[terminalButtons()]});
     return;
    }
    if(name==="files") {
     const s=getActiveServer(i.user.id);
     await i.reply({embeds:[new EmbedBuilder().setTitle(`📁 File Manager • ${s.name}`).setDescription("ใช้ปุ่มด้านล่างจัดการไฟล์ใน Virtual Linux").setColor(0x5865f2)],components:fileButtons()});
     return;
    }
    if(name==="linuxhelp") {
     await i.reply({embeds:[new EmbedBuilder().setTitle("🐧 LinuxBot V1").setColor(0x5865f2).setDescription([
      "`/server create <name>` สร้าง VPS",
      "`/server list` ดู VPS",
      "`/server use <name>` เลือก VPS",
      "`/server delete <name>` ลบ VPS",
      "`/server info` ข้อมูล VPS",
      "`/terminal` เปิด Terminal",
      "`/files` เปิด File Manager",
      "",
      "Terminal: `ls cd pwd mkdir rmdir touch cat echo rm cp mv tree`",
      "System: `whoami users id hostname uname date`",
      "Package: `apt update/list/install/remove`",
      "Process: `ps top kill`",
      "Service: `service <name> status/start/stop/restart`",
      "User: `useradd userdel chmod chown`"
     ].join("\n"))]});
    }
    return;
   }

   if(i.isButton()) {
    const s=getActiveServer(i.user.id);
    if(i.customId==="term_enter") { await i.showModal(commandModal("🐧 Linux Terminal","term_modal","Linux command","ls, mkdir test, cd test, apt install nginx")); return; }
    if(i.customId==="server_info") { await i.reply({embeds:[serverInfo(i.user.id)],ephemeral:true}); return; }
    if(i.customId==="file_manager") { await i.reply({embeds:[new EmbedBuilder().setTitle(`📁 File Manager • ${s.name}`).setColor(0x5865f2).setDescription("เลือกการทำงาน")],components:fileButtons(),ephemeral:true}); return; }
    if(i.customId==="file_ls") { await i.reply({content:"```text\n"+runCommand(s,"ls")+"\n```",ephemeral:true}); return; }
    if(i.customId==="file_write") { await i.showModal(commandModal("📝 Write File","file_write_modal","path + content","example: notes.txt | hello world")); return; }
    if(i.customId==="file_read") { await i.showModal(commandModal("📖 Read File","file_read_modal","File path","example: notes.txt")); return; }
    if(i.customId==="file_delete") { await i.showModal(commandModal("🗑️ Delete File","file_delete_modal","File path","example: notes.txt")); return; }
   }

   if(i.isModalSubmit()) {
    const s=getActiveServer(i.user.id);
    const value=i.fields.getTextInputValue("value");
    if(i.customId==="term_modal") {
     const out=runCommand(s,value);
     await i.reply({embeds:[terminalEmbed(s,out,value)],components:[terminalButtons()]}); return;
    }
    if(i.customId==="file_write_modal") {
     const idx=value.indexOf("|"); if(idx<1) {await i.reply({content:"รูปแบบ: filename | content",ephemeral:true});return;}
     const p=value.slice(0,idx).trim(), content=value.slice(idx+1).trim();
     runCommand(s,`echo "${content.replaceAll('"','')} " > "${p}"`);
     await i.reply({content:`✓ เขียนไฟล์ \`${p}\` แล้ว`,ephemeral:true}); return;
    }
    if(i.customId==="file_read_modal") { await i.reply({content:"```text\n"+runCommand(s,`cat "${value}"`)+"\n```",ephemeral:true}); return; }
    if(i.customId==="file_delete_modal") { await i.reply({content:runCommand(s,`rm "${value}"`),ephemeral:true}); return; }
   }
  } catch(e) {
   const msg=e instanceof Error?e.message:String(e);
   if(i.isRepliable()&&!i.replied&&!i.deferred) await i.reply({content:`❌ ${msg}`,ephemeral:true});
  }
 });
}

async function main(){
 console.log("── AUTO SETUP ──");
 const ctx:SetupContext={env:process.env,state:{}};
 const report=await runSetup(buildBootSteps(),ctx);
 printReport(report.results);
 const doctorStep=report.results.find(r=>r.id==="doctor");
 const readyNote=report.ready
  ?doctorStep&&(doctorStep.status==="FAIL"||doctorStep.status==="WARN")?`system ready (ยังมี ${doctorStep.status==="FAIL"?"ข้อที่ต้องแก้":"คำเตือน"} ตาม doctor)`:"system ready"
  :"system blocked";
 console.log(`── READY: ${readyNote} ──`);

 const client=ctx.state.client as Client|undefined;
 const db=ctx.db??openDatabase();

 const health=startHealthServer({db,runtime:()=>({
  discord:client?.isReady()?"online":"offline",
  pingMs:client?.isReady()?Math.round(client.ws.ping):null,
  uptimeSec:Math.floor(process.uptime()),
  guildCount:client?.guilds.cache.size??0
 })});

 if(!client){
  console.error("");
  console.error("บอทไม่สามารถออนไลน์ได้ แก้ขั้นตอนที่ FAIL ข้างบนแล้วรันใหม่");
  console.error(formatReport([]));
  await new Promise<void>(r=>health.close(()=>r()));
  try{db.close();}catch{}
  process.exit(1);
 }

 loadUsers();
 registerHandlers(client);

 installShutdown([
  {name:"หยุดรับงานใหม่ (health API)",run:()=>new Promise<void>(r=>health.close(()=>r()))},
  {name:"บันทึก state ของ virtual server",run:()=>saveUsers()},
  {name:"ปิด database",run:()=>{db.close();}},
  {name:"ตัดการเชื่อมต่อ Discord",run:()=>client.destroy()}
 ]);
}

main().catch(e=>{
 console.error(`✗ boot ล้มเหลว: ${e instanceof Error?e.message:String(e)}`);
 process.exit(1);
});