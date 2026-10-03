export type EnvSpec={
 key:string;
 required:boolean;
 autoGenerate?:boolean;
 description:string;
 validate?:(value:string)=>string|null;
};

const snowflake=(v:string)=>/^\d{17,20}$/.test(v)?null:`${"{KEY}"} ต้องเป็น Discord ID (ตัวเลข 17-20 หลัก)`;

export const ENV_SPECS:EnvSpec[]=[
 {key:"NODE_ENV",required:false,description:"production หรือ development"},
 {key:"PORT",required:false,description:"พอร์ตของ API และ Dashboard",
  validate:v=>{const n=Number(v);return Number.isInteger(n)&&n>0&&n<65536?null:"PORT ต้องเป็นเลข 1-65535";}},
 {key:"DISCORD_TOKEN",required:true,description:"Bot Token จาก Discord Developer Portal",
  validate:v=>v.split(".").length===3?null:"DISCORD_TOKEN ต้องมี 3 ส่วนคั่นด้วยจุด"},
 {key:"DISCORD_CLIENT_ID",required:false,description:"Application ID — ถ้าไม่ตั้งระบบหาเองจาก token ได้",
  validate:v=>snowflake(v)},
 {key:"DISCORD_CLIENT_SECRET",required:false,description:"จำเป็นสำหรับ OAuth2 login ของ Dashboard"},
 {key:"DISCORD_REDIRECT_URI",required:false,description:"ต้องตรงกับ OAuth2 redirect ใน Developer Portal",
  validate:v=>{try{new URL(v);return null;}catch{return "DISCORD_REDIRECT_URI ไม่ใช่ URL ที่ถูกต้อง";}}},
 {key:"GUILD_ID",required:false,description:"ถ้าไม่ตั้งจะใช้ server เดียวที่บอทอยู่",validate:v=>snowflake(v)},
 {key:"ADMIN_ROLE_ID",required:false,description:"ถ้าไม่ตั้งจะใช้สิทธิ์ Administrator ของ Discord",validate:v=>snowflake(v)},
 {key:"OPENROUTER_API_KEY",required:false,description:"จำเป็นสำหรับฟีเจอร์ AI"},
 {key:"OPENROUTER_MODEL",required:false,description:"เช่น anthropic/claude-sonnet-4"},
 {key:"DASHBOARD_URL",required:false,description:"URL สาธารณะของ Dashboard ใช้คำนวณ OAuth2 redirect",
  validate:v=>{try{new URL(v);return null;}catch{return "DASHBOARD_URL ไม่ใช่ URL ที่ถูกต้อง";}}},
 {key:"SESSION_SECRET",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"},
 {key:"COOKIE_SECRET",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"},
 {key:"ENCRYPTION_KEY",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"},
 {key:"INTERNAL_API_SECRET",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"},
 {key:"WEBHOOK_SIGNING_SECRET",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"},
 {key:"BACKUP_ENCRYPTION_KEY",required:false,autoGenerate:true,description:"สร้างอัตโนมัติถ้ายังไม่มี"}
];

export const AUTO_GENERATED_KEYS=ENV_SPECS.filter(s=>s.autoGenerate).map(s=>s.key);
export const REQUIRED_KEYS=ENV_SPECS.filter(s=>s.required).map(s=>s.key);

export function findSpec(key:string){
 return ENV_SPECS.find(s=>s.key===key);
}

export function validateValue(key:string,value:string){
 const spec=findSpec(key);
 if(!spec||!spec.validate) return null;
 const problem=spec.validate(value);
 return problem?problem.replace("{KEY}",key):null;
}