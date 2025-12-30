const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// 1. 数据库连接
const MONGO_URI = process.env.MONGO_URL || "mongodb://localhost:27017/game-center";
const AUTH_CODE = process.env.REG_AUTH_CODE || "666"; // 注册授权码，上线后可在平台配置

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ 数据库连接成功"))
    .catch(err => console.error("❌ 数据库连接失败:", err));

// 2. 定义管理员模型
const AdminSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', AdminSchema);

// 3. 定义游戏记录模型 (新增)
const RecordSchema = new mongoose.Schema({
    owner: { type: String, required: true, index: true }, // 对应管理员的 username
    roleId: String,
    roleName: String,
    server: String,
    status: String,
    time: { type: Date, default: Date.now }
});
const Record = mongoose.model('Record', RecordSchema);

// 4. 注册接口 (增强校验)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, authCode } = req.body;
        
        const currentAuthCode = process.env.REG_AUTH_CODE || "666";
        if (authCode !== currentAuthCode) {
            return res.status(400).json({ message: "无效的授权码" });
        }
        
        // 增加注册格式要求
        if (!username || username.length < 4) {
            return res.status(400).json({ message: "账号至少需要 4 位字符" });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ message: "密码至少需要 6 位字符" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new Admin({ username, password: hashedPassword });
        await newAdmin.save();
        
        res.json({ message: "注册成功" });
    } catch (err) {
        res.status(500).json({ message: "账号已存在或服务器错误" });
    }
});

// 5. 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await Admin.findOne({ username });

        if (!user) return res.status(400).json({ message: "账号不存在" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "密码错误" });
        
        res.json({ message: "登录成功", username: user.username });
    } catch (err) {
        res.status(500).json({ message: "服务器错误" });
    }
});

// 6. 游戏记录相关接口 (新增)
// 保存记录
app.post('/api/records', async (req, res) => {
    try {
        const { username, records } = req.body; // records 是一个数组
        if (!username) return res.status(400).json({ message: "未登录" });

        // 将每条记录都打上 owner 标签并存入数据库
        const recordsToSave = records.map(r => ({
            ...r,
            owner: username,
            time: new Date()
        }));

        await Record.insertMany(recordsToSave);
        res.json({ message: "数据已同步至云端" });
    } catch (err) {
        console.error("Save Records Error:", err);
        res.status(500).json({ message: "同步失败" });
    }
});

// 获取记录
app.get('/api/records', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ message: "未登录" });

        const data = await Record.find({ owner: username }).sort({ time: -1 });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "获取数据失败" });
    }
});

// 清理记录
app.delete('/api/records', async (req, res) => {
    try {
        const { username } = req.query;
        await Record.deleteMany({ owner: username });
        res.json({ message: "记录已清空" });
    } catch (err) {
        res.status(500).json({ message: "清理失败" });
    }
});

// 7. 托管前端静态文件
app.use(express.static(path.join(__dirname, '/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 本地测试服务器已启动: http://localhost:${PORT}`);
    console.log(`👉 请在浏览器打开上述链接进行测试`);
});