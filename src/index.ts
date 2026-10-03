import "dotenv/config";
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { loadUsers, getActiveServer, addServer, listServers, useServer, deleteServer, getState } from "./storage.js";
import { runCommand } from "./linux.js";
import { terminalEmbed, terminalButtons, fileButtons, commandModal, serverListEmbed, serverInfo } from "./ui.js";

const token=process.env.DISCORD_TOKEN;
if(!token) throw new Error("Missing DISCORD_TOKEN");
loadUsers();

const client=new Client({intents:[GatewayIntentBits.Guilds]});

client.once(Events.ClientReady,c=>console.log(`🐧 LinuxBot online as ${c.user.tag}`));

client.on(Events.InteractionCreate,async i=>{
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
        ].join("\\n"))]});
      }
      return;
    }

    if(i.isButton()) {
      const s=getActiveServer(i.user.id);
      if(i.customId==="term_enter") { await i.showModal(commandModal("🐧 Linux Terminal","term_modal","Linux command","ls, mkdir test, cd test, apt install nginx")); return; }
      if(i.customId==="server_info") { await i.reply({embeds:[serverInfo(i.user.id)],ephemeral:true}); return; }
      if(i.customId==="file_manager") { await i.reply({embeds:[new EmbedBuilder().setTitle(`📁 File Manager • ${s.name}`).setColor(0x5865f2).setDescription("เลือกการทำงาน")],components:fileButtons(),ephemeral:true}); return; }
      if(i.customId==="file_ls") { await i.reply({content:"```text\\n"+runCommand(s,"ls")+"\\n```",ephemeral:true}); return; }
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
      if(i.customId==="file_read_modal") { await i.reply({content:"```text\\n"+runCommand(s,`cat "${value}"`)+"\\n```",ephemeral:true}); return; }
      if(i.customId==="file_delete_modal") { await i.reply({content:runCommand(s,`rm "${value}"`),ephemeral:true}); return; }
    }
  } catch(e) {
    const msg=e instanceof Error?e.message:String(e);
    if(i.isRepliable()&&!i.replied&&!i.deferred) await i.reply({content:`❌ ${msg}`,ephemeral:true});
  }
});

client.login(token);
