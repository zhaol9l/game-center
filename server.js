const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
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
    nickname: { type: String, default: "" },
    avatar: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', AdminSchema);

// 3. 定义游戏记录模型
const RecordSchema = new mongoose.Schema({
    id: String, // 前端生成的唯一 ID
    owner: { type: String, required: true },
    gameName: String, // 游戏名称
    roleId: String,
    roleName: String,
    server: String,
    status: String,
    time: { type: Date, default: Date.now, expires: 604800 } // 7天后自动删除 (7 * 24 * 60 * 60)
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
        
        res.json({ 
            message: "登录成功", 
            username: user.username,
            nickname: user.nickname,
            avatar: user.avatar
        });
    } catch (err) {
        res.status(500).json({ message: "服务器错误" });
    }
});

// 6. 修改密码接口
app.post('/api/update-password', async (req, res) => {
    try {
        const { username, oldPassword, newPassword } = req.body;
        if (!username || !oldPassword || !newPassword) {
            return res.status(400).json({ message: "缺少必要参数" });
        }

        const user = await Admin.findOne({ username });
        if (!user) return res.status(400).json({ message: "用户不存在" });

        // 验证旧密码
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "当前密钥错误" });

        // 加密新密码
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();

        res.json({ message: "密码修改成功" });
    } catch (err) {
        res.status(500).json({ message: "服务器错误" });
    }
});

// 7. 个人资料接口
app.post('/api/update-profile', async (req, res) => {
    try {
        const { username, nickname, avatar } = req.body;
        if (!username) return res.status(400).json({ message: "未登录" });

        const user = await Admin.findOne({ username });
        if (!user) return res.status(400).json({ message: "用户不存在" });

        if (nickname !== undefined) user.nickname = nickname;
        if (avatar !== undefined) user.avatar = avatar;
        
        await user.save();
        res.json({ message: "资料更新成功", nickname: user.nickname, avatar: user.avatar });
    } catch (err) {
        res.status(500).json({ message: "服务器错误" });
    }
});

// 8. 游戏记录相关接口
app.post('/api/records', async (req, res) => {
    try {
        const { username, records } = req.body;
        
        if (!username) {
            console.warn("⚠️ 收到无用户名的同步请求");
            return res.status(400).json({ message: "未登录" });
        }
        if (!records || !Array.isArray(records)) {
            return res.status(400).json({ message: "无效的数据格式" });
        }

        console.log(`📥 正在同步用户 [${username}] 的数据, 条数: ${records.length}`);

        // 彻底清理数据，只保留我们需要的业务字段，完全由云端生成新的 _id
        const recordsToSave = records.map(r => ({
            id: String(r.id || ""), // 保留前端生成的 ID
            gameName: String(r.gameName || ""), 
            roleId: String(r.roleId || ""),
            roleName: String(r.roleName || ""),
            server: String(r.server || ""),
            status: String(r.status || "待处理"),
            owner: String(username),
            time: r.time ? new Date(r.time) : new Date()
        }));

        // 使用 upsert 逻辑防止重复 (如果前端有唯一 ID)
        for (const record of recordsToSave) {
            if (record.id) {
                await Record.findOneAndUpdate(
                    { id: record.id, owner: username },
                    record,
                    { upsert: true, new: true }
                );
            } else {
                await new Record(record).save();
            }
        }

        console.log(`✅ 用户 [${username}] 的数据同步完成`);
        res.json({ message: "数据已同步至云端" });
    } catch (err) {
        console.error("❌ Save Records Error:", err.message);
        res.status(500).json({ message: "同步失败: " + err.message });
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

// 清理记录 (支持清理全部或单条)
app.delete('/api/records', async (req, res) => {
    try {
        const { username, id } = req.query;
        if (!username) return res.status(400).json({ message: "用户名必填" });

        if (id) {
            // 尝试通过自定义 id 或 MongoDB 的 _id 删除
            const query = { owner: username, $or: [{ id: id }] };
            if (mongoose.Types.ObjectId.isValid(id)) {
                query.$or.push({ _id: id });
            }
            await Record.deleteOne(query);
            res.json({ message: "记录已删除" });
        } else {
            // 清空全部
            await Record.deleteMany({ owner: username });
            res.json({ message: "记录已清空" });
        }
    } catch (err) {
        res.status(500).json({ message: "删除失败" });
    }
});

// 11. 注销账户接口
app.delete('/api/delete-account', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "缺少必要参数" });

        const user = await Admin.findOne({ username });
        if (!user) return res.status(400).json({ message: "用户不存在" });

        // 验证密码
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "密码错误，无法注销" });

        // 1. 删除用户的所有记录
        await Record.deleteMany({ owner: username });
        
        // 2. 删除用户账号
        await Admin.deleteOne({ username });

        res.json({ message: "账号及其数据已永久删除" });
    } catch (err) {
        res.status(500).json({ message: "注销失败: " + err.message });
    }
});

// 7. 托管前端静态文件
app.use(express.static(path.join(__dirname, '/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 本地测试服务器已启动: http://localhost:${PORT}`);
    console.log(`👉 请在浏览器打开上述链接进行测试`);
});