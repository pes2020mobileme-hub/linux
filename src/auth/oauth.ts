import crypto from "node:crypto";

export type OAuthConfig={ clientId:string; clientSecret:string; redirectUri:string };

export const OAUTH_SCOPES=["identify","guilds"] as const;
export const OAUTH_GUILD_SCOPES=["identify","guilds","guilds.members.read"] as const;

const AUTHORIZE_URL="https://discord.com/oauth2/authorize";
const TOKEN_URL="https://discord.com/api/oauth2/token";
const USER_URL="https://discord.com/api/users/@me";
const USER_GUILDS_URL="https://discord.com/api/users/@me/guilds";

export type Pkce={ verifier:string; challenge:string; state:string };

export function createPkce():Pkce{
 const verifier=crypto.randomBytes(32).toString("base64url");
 const challenge=crypto.createHash("sha256").update(verifier,"utf8").digest("base64url");
 const state=crypto.randomBytes(16).toString("base64url");
 return {verifier,challenge,state};
}

export function authorizeUrl(config:Pkce & { clientId:string; scopes?:readonly string[] }){
 const params=new URLSearchParams({
  client_id:config.clientId,
  response_type:"code",
  redirect_uri:requireRedirect(),
  scope:(config.scopes??OAUTH_SCOPES).join(" "),
  state:config.state,
  code_challenge:config.challenge,
  code_challenge_method:"S256"
 });
 return `${AUTHORIZE_URL}?${params.toString()}`;
}

function requireRedirect(){
 const uri=process.env.DISCORD_REDIRECT_URI;
 if(!uri) throw new Error("ยังไม่ได้ตั้ง DISCORD_REDIRECT_URI");
 return uri;
}

export type TokenResponse={ access_token:string; token_type:string; expires_in:number; refresh_token?:string; scope:string };

export type FetchLike=(url:string,init:{method:string;headers:Record<string,string>;body:string})=>Promise<{status:number;json:(()=>Promise<any>)}>;

export async function exchangeCode(config:OAuthConfig,pkce:Pkce,code:string,fetchImpl:FetchLike):Promise<TokenResponse>{
 if(!code) throw new Error("ไม่ได้รับ authorization code");
 const body=new URLSearchParams({
  client_id:config.clientId,
  client_secret:config.clientSecret,
  grant_type:"authorization_code",
  code,
  redirect_uri:config.redirectUri,
  code_verifier:pkce.verifier
 }).toString();
 const res=await fetchImpl(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
 const data=await res.json().catch(()=>({}));
 if(res.status!==200||!data.access_token) throw new Error(`token exchange ล้มเหลว (${res.status}): ${data.error_description??data.error??"ไม่ทราบสาเหตุ"}`);
 return data as TokenResponse;
}

export type OAuthUser={ id:string; username:string; global_name?:string|null };

export async function fetchUser(accessToken:string,fetchImpl:FetchLike):Promise<OAuthUser>{
 const res=await fetchImpl(USER_URL,{method:"GET",headers:{authorization:`Bearer ${accessToken}`},body:""});
 const data=await res.json().catch(()=>({}));
 if(res.status!==200||!data.id) throw new Error(`ดึงข้อมูลผู้ใช้ไม่สำเร็จ (${res.status})`);
 return {id:String(data.id),username:String(data.username),global_name:data.global_name??null};
}

export type OAuthGuild={ id:string; name:string; permissions:string; owner:boolean };

export async function fetchGuilds(accessToken:string,fetchImpl:FetchLike):Promise<OAuthGuild[]>{
 const res=await fetchImpl(USER_GUILDS_URL,{method:"GET",headers:{authorization:`Bearer ${accessToken}`},body:""});
 const data=await res.json().catch(()=>null);
 if(res.status!==200||!Array.isArray(data)) throw new Error(`ดึงรายชื่อ server ไม่สำเร็จ (${res.status})`);
 return data.map((g:Record<string,unknown>)=>({id:String(g.id),name:String(g.name),permissions:String(g.permissions),owner:Boolean(g.owner)}));
}

const MANAGE_GUILD=1n<<5n;
const ADMINISTRATOR=1n<<8n;

export function canManage(guild:OAuthGuild){
 if(guild.owner) return {ok:true,reason:"เจ้าของ server"};
 const bits=BigInt(guild.permissions);
 if((bits&ADMINISTRATOR)!==0n) return {ok:true,reason:"มีสิทธิ์ Administrator"};
 if((bits&MANAGE_GUILD)!==0n) return {ok:true,reason:"มีสิทธิ์ Manage Server"};
 return {ok:false,reason:"ไม่มีสิทธิ์ Manage Server หรือ Administrator"};
}

export type RedirectDecision={ ok:boolean; reason:string; expected:string };

export function verifyRedirect(configured:string|undefined,requestUri:string):RedirectDecision{
 if(!configured) return {ok:false,reason:"ระบบยังไม่ได้ตั้ง DISCORD_REDIRECT_URI",expected:""};
 let a:string,b:string;
 try{ a=new URL(configured).origin+new URL(configured).pathname; b=new URL(requestUri).origin+new URL(requestUri).pathname; }
 catch{ return {ok:false,reason:"redirect URI ไม่ใช่ URL ที่ถูกต้อง",expected:configured}; }
 return a===b?{ok:true,reason:"ตรงกัน",expected:configured}:{ok:false,reason:"redirect URI ไม่ตรงกับที่ตั้งไว้",expected:configured};
}

export type Session={ userId:string; username:string; guildIds:string[]; issuedAt:number; expiresAt:number };

export function createSession(user:OAuthUser,guilds:OAuthGuild[],ttlSec=86400,now=Date.now()):Session{
 return {userId:user.id,username:user.username,guildIds:guilds.map(g=>g.id),issuedAt:now,expiresAt:now+ttlSec*1000};
}

export function readSession(session:Session|null,now=Date.now()){
 if(!session) return {ok:false,reason:"ยังไม่ได้ login"};
 if(session.expiresAt<=now) return {ok:false,reason:"session หมดอายุ"};
 return {ok:true,reason:"ใช้งานได้",session};
}
