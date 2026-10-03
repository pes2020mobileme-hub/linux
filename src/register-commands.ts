import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandJson } from "./commands.js";

async function main(){
 const {DISCORD_TOKEN:token,CLIENT_ID:clientId,GUILD_ID:guildId}=process.env;
 if(!token||!clientId||!guildId) throw new Error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID");
 const rest=new REST({version:"10"}).setToken(token);
 await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commandJson});
 console.log(`✓ Commands registered (${commandJson.length}: ${commandJson.map(c=>c.name).join(", ")})`);
}

main().catch(e=>{
 const status=e instanceof Error&&"status" in e?String((e as {status:unknown}).status):"";
 console.error(status==="401"?"✗ DISCORD_TOKEN ไม่ถูกต้อง (401 Unauthorized)":status==="403"?"✗ บอทไม่มีสิทธิ์ applications.commands ใน server นี้ (403 Forbidden)":`✗ Register ล้มเหลว: ${e instanceof Error?e.message:String(e)}`);
 process.exit(1);
});