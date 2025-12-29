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

// 3. 注册接口
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, authCode } = req.body;
        
        // 验证授权码
        if (authCode !== AUTH_CODE) {
            return res.status(400).json({ message: "无效的授权码" });
        }
        
        if (!username || !password || username.length < 3) {
            return res.status(400).json({ message: "账号或密码格式不正确" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new Admin({ username, password: hashedPassword });
        await newAdmin.save();
        
        res.json({ message: "注册成功" });
    } catch (err) {
        res.status(500).json({ message: "账号已存在或服务器错误" });
    }
});

// 4. 登录接口
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

// 5. 托管前端静态文件
app.use(express.static(path.join(__dirname, '/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 本地测试服务器已启动: http://localhost:${PORT}`);
    console.log(`👉 请在浏览器打开上述链接进行测试`);
});