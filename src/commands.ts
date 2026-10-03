import { SlashCommandBuilder } from "discord.js";

export const commands=[
 new SlashCommandBuilder().setName("server").setDescription("จัดการ Virtual Linux VPS")
  .addSubcommand(s=>s.setName("create").setDescription("สร้าง server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
  .addSubcommand(s=>s.setName("list").setDescription("ดู server ทั้งหมด"))
  .addSubcommand(s=>s.setName("use").setDescription("เลือก server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
  .addSubcommand(s=>s.setName("delete").setDescription("ลบ server").addStringOption(o=>o.setName("name").setDescription("ชื่อ server").setRequired(true)))
  .addSubcommand(s=>s.setName("info").setDescription("ข้อมูล server ปัจจุบัน")),
 new SlashCommandBuilder().setName("terminal").setDescription("เปิด Virtual Linux Terminal").addStringOption(o=>o.setName("command").setDescription("Linux command").setRequired(false).setMaxLength(500)),
 new SlashCommandBuilder().setName("files").setDescription("เปิด File Manager"),
 new SlashCommandBuilder().setName("linuxhelp").setDescription("ดูคำสั่ง LinuxBot")
];

export const commandJson=commands.map(x=>x.toJSON());