import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const {DISCORD_TOKEN:token,CLIENT_ID:clientId,GUILD_ID:guildId}=process.env;
if(!token||!clientId||!guildId) throw new Error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID");

const server=new SlashCommandBuilder().setName("server").setDescription("จัดการ Virtual Linux VPS")
 .addSubcommand(s=>s.setName("create").setDescription("สร้าง server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
 .addSubcommand(s=>s.setName("list").setDescription("ดู server ทั้งหมด"))
 .addSubcommand(s=>s.setName("use").setDescription("เลือก server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
 .addSubcommand(s=>s.setName("delete").setDescription("ลบ server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
 .addSubcommand(s=>s.setName("info").setDescription("ข้อมูล server ปัจจุบัน"));

const commands=[
 server,
 new SlashCommandBuilder().setName("terminal").setDescription("เปิด Virtual Linux Terminal").addStringOption(o=>o.setName("command").setDescription("Linux command").setRequired(false).setMaxLength(500)),
 new SlashCommandBuilder().setName("files").setDescription("เปิด File Manager"),
 new SlashCommandBuilder().setName("linuxhelp").setDescription("ดูคำสั่ง LinuxBot")
].map(x=>x.toJSON());

const rest=new REST({version:"10"}).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands});
console.log("✓ Commands registered");
