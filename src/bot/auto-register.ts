import { REST, Routes } from "discord.js";
import { commandJson } from "../commands.js";

export type RegisterResult={ ok:boolean; attempts:number; error?:string };

export async function registerCommands(clientId:string,guildId:string,attempts=4):Promise<RegisterResult>{
 const token=process.env.DISCORD_TOKEN;
 if(!token) return {ok:false,attempts:0,error:"ไม่มี DISCORD_TOKEN"};
 let delay=1000;
 let lastError="";
 for(let i=1;i<=attempts;i++){
  try{
   const rest=new REST({version:"10"}).setToken(token);
   await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commandJson});
   return {ok:true,attempts:i};
  }catch(e){
   lastError=e instanceof Error?e.message:String(e);
   if(i<attempts){
    console.warn(`⚠ register ไม่สำเร็จ (ครั้งที่ ${i}/${attempts}): ${lastError} — ลองใหม่ใน ${delay}ms`);
    await new Promise(r=>setTimeout(r,delay));
    delay*=2;
   }
  }
 }
 return {ok:false,attempts,error:lastError};
}