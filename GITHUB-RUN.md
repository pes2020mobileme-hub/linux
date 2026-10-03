# 🐧 LinuxBot — GitHub → Run → Online

วิธีนี้ทำให้คุณเก็บโค้ดไว้บน GitHub แล้วกด **Run workflow** เพื่อเปิด LinuxBot โดยไม่ต้องเปิด CMD บนเครื่องตัวเอง

> **สำคัญ:** GitHub-hosted Actions ใช้เครื่องชั่วคราว จึงเหมาะกับการทดสอบ/ใช้งานชั่วคราว ไม่ใช่บริการ 24/7 ถ้าต้องการเปิดทั้งวันทั้งคืน ควรย้าย runtime ไป VPS/Cloud หรือใช้ self-hosted runner

## 1. อัปโหลดโปรเจกต์ขึ้น GitHub

สร้าง repository ใหม่ เช่น `LinuxBot-V1` แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้

## 2. เพิ่ม GitHub Secrets

เข้า repository → **Settings → Secrets and variables → Actions → New repository secret**

เพิ่ม:

- `DISCORD_TOKEN` = Bot Token จาก Discord Developer Portal
- `CLIENT_ID` = Application ID ของ Discord Bot
- `GUILD_ID` = ID ของ Discord Server ที่จะใช้
- `ADMIN_ROLE_ID` = Role ID (ปล่อยว่างได้)

**ห้ามใส่ Bot Token ใน source code หรือ commit ลง GitHub**

## 3. กด Run

เข้าแท็บ **Actions** → เลือก **🐧 LinuxBot — Run** → **Run workflow** → **Run workflow**

Workflow จะทำให้อัตโนมัติ:

1. Checkout โค้ด
2. ติดตั้ง Node.js
3. ติดตั้ง dependencies
4. Register slash commands
5. Build TypeScript
6. Start LinuxBot

เมื่อขั้นตอน **Start LinuxBot** กำลังทำงาน = Bot กำลังออนไลน์

## 4. หยุด Bot

เปิด workflow run ที่กำลังทำงาน แล้วกด **Cancel workflow**

## 5. แก้โค้ด

Push โค้ดใหม่ขึ้น GitHub แล้วกด Run workflow ใหม่

## ข้อจำกัด

GitHub Actions runner เป็นเครื่องชั่วคราว เมื่อ workflow จบ ข้อมูลใน `data/users.json` บน runner จะไม่ถูกเก็บเป็นฐานข้อมูลถาวร

ดังนั้นเวอร์ชันนี้เหมาะกับการทดสอบ/ทดลองก่อน หากต้องการ production 24/7 ควรใช้ VPS/Cloud + database/volume ถาวร
