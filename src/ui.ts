import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from "discord.js";
import { getActiveServer, getState } from "./storage.js";
import { runCommand } from "./linux.js";

export function terminalEmbed(server:any, output:string, command?:string) {
  const line = command ? `${server.currentUser}@${server.hostname}:${"/"+server.cwd.join("/")}$ ${command}\n` : "";
  return new EmbedBuilder()
    .setTitle(`🐧 ${server.name} • Terminal`)
    .setColor(0x2b2d31)
    .setDescription("```text\n"+(line+output).slice(0,3900)+"\n```")
    .setFooter({text:"LinuxBot V1 • Virtual Linux sandbox"});
}

export function terminalButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("term_enter").setLabel("Enter Command").setEmoji("⌨️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("file_manager").setLabel("File Manager").setEmoji("📁").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("server_info").setLabel("Server Info").setEmoji("🖥️").setStyle(ButtonStyle.Secondary)
  );
}

export function fileButtons() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("file_ls").setLabel("List").setEmoji("📂").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("file_write").setLabel("Write").setEmoji("📝").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("file_read").setLabel("Read").setEmoji("📖").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("file_delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("term_enter").setLabel("Terminal").setEmoji("⌨️").setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function commandModal(title:string, id:string, label:string, placeholder:string) {
  const modal=new ModalBuilder().setCustomId(id).setTitle(title);
  const input=new TextInputBuilder().setCustomId("value").setLabel(label).setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1000);
  return modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function serverListEmbed(userId:string) {
  const state=getState(userId);
  const list=Object.values(state.servers);
  return new EmbedBuilder().setTitle("🖥️ Your Virtual Servers").setColor(0x5865f2)
    .setDescription(list.length ? list.map(s=>`${state.activeServer===s.name?"🟢":"⚪"} **${s.name}** • ${s.distro}`).join("\n") : "ยังไม่มี server");
}

export function serverInfo(userId:string) {
  const s=getActiveServer(userId);
  return new EmbedBuilder().setTitle(`🖥️ ${s.name}`).setColor(0x57f287)
    .addFields(
      {name:"OS",value:s.distro,inline:true},
      {name:"Hostname",value:s.hostname,inline:true},
      {name:"User",value:s.currentUser,inline:true},
      {name:"Packages",value:String(s.packages.installed.length),inline:true},
      {name:"Processes",value:String(s.processes.length),inline:true},
      {name:"Created",value:new Date(s.createdAt).toLocaleString("th-TH"),inline:true}
    );
}
