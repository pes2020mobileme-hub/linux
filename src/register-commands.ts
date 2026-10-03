import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commandJson } from "./commands.js";
import { pickGuildId } from "./config/discovery.js";
import { registerCommands } from "./bot/auto-register.js";

async function main(){
 const {DISCORD_TOKEN:token}=process.env;
 if(!token) throw new Error("Missing DISCORD_TOKEN");

 const client=new Client({intents:[GatewayIntentBits.Guilds]});
 const ready=new Promise<void>((resolve,reject)=>{
  client.once(Events.ClientReady,()=>resolve());
  setTimeout(()=>reject(new Error("ต่อ Discord Gateway ไม่ได้ภายใน 30 วินาที")),30000);
 });
 try{
  await client.login(token);
  await ready;
 }catch(e){
  try{client.destroy();}catch{}
  throw e;
 }

 try{
  const picked=pickGuildId(client);
  if(!picked.ok) throw new Error(picked.reason);
  const clientId=process.env.DISCORD_CLIENT_ID||client.user?.id;
  if(!clientId) throw new Error("หา Application ID จาก token ไม่สำเร็จ");

  const guild=client.guilds.cache.get(picked.id);
  console.log(`ใช้ client ${clientId} · server ${guild?.name??picked.id} (${picked.id}) — ${picked.how}`);

  const result=await registerCommands(clientId,picked.id);
  if(!result.ok) throw new Error(result.error??"register ไม่สำเร็จ");
  console.log(`✓ Commands registered (${commandJson.length}: ${commandJson.map(c=>c.name).join(", ")}) · ลอง ${result.attempts} ครั้ง`);
 }finally{
  client.destroy();
 }
}

main().catch(e=>{
 const message=e instanceof Error?e.message:String(e);
 const status=e instanceof Error&&"status" in e?String((e as {status:unknown}).status):"";
 console.error(status==="401"?"✗ DISCORD_TOKEN ไม่ถูกต้อง (401 Unauthorized)":status==="403"?"✗ บอทไม่มีสิทธิ์ applications.commands ใน server นี้ (403 Forbidden)":`✗ Register ล้มเหลว: ${message}`);
 process.exit(1);
});