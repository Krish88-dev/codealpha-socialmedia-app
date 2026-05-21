const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
  });
});

const PORT = 3000;
const SECRET_KEY = 'super_secret_social_key_123';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Middleware for auth
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const verified = jwt.verify(token, SECRET_KEY);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, bio } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: { username, password: hashedPassword, bio },
    });

    const token = jwt.sign({ id: user.id }, SECRET_KEY);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, SECRET_KEY);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, bio: true, avatarUrl: true }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- POST ROUTES ---
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
        likes: true,
        comments: {
          include: { author: { select: { id: true, username: true } } }
        }
      }
    });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/posts', authenticate, upload.single('media'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content && !req.file) return res.status(400).json({ error: 'Content or media is required' });

    let mediaUrl = null;
    let mediaType = null;
    if (req.file) {
      mediaUrl = `/uploads/${req.file.filename}`;
      mediaType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    }

    const post = await prisma.post.create({
      data: { content: content || '', authorId: req.user.id, mediaUrl, mediaType },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
        likes: true,
        comments: { include: { author: { select: { id: true, username: true } } } }
      }
    });
    io.emit('new_post', post);
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/posts/:id/like', authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;

    const existingLike = await prisma.like.findUnique({
      where: { postId_userId: { postId, userId } }
    });

    if (existingLike) {
      await prisma.like.delete({ where: { id: existingLike.id } });
      res.json({ liked: false });
    } else {
      await prisma.like.create({ data: { postId, userId } });
      res.json({ liked: true });

      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (post && post.authorId !== userId) {
        const notif = await prisma.notification.create({
          data: { type: 'LIKE', actorId: userId, userId: post.authorId, postId },
          include: { actor: { select: { id: true, username: true } }, post: { select: { content: true } } }
        });
        io.to(`user_${post.authorId}`).emit('new_notification', notif);
      }
    }
    
    // Fetch and emit updated post
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
        likes: true,
        comments: { include: { author: { select: { id: true, username: true } } } }
      }
    });
    if (updatedPost) io.emit('post_updated', updatedPost);

  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/posts/:id/comments', authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const comment = await prisma.comment.create({
      data: { content, postId, authorId: req.user.id },
      include: { author: { select: { id: true, username: true } } }
    });
    res.json(comment);

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (post && post.authorId !== req.user.id) {
      const notif = await prisma.notification.create({
        data: { type: 'COMMENT', actorId: req.user.id, userId: post.authorId, postId },
        include: { actor: { select: { id: true, username: true } }, post: { select: { content: true } } }
      });
      io.to(`user_${post.authorId}`).emit('new_notification', notif);
    }

    // Fetch and emit updated post
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
        likes: true,
        comments: { include: { author: { select: { id: true, username: true } } } }
      }
    });
    if (updatedPost) io.emit('post_updated', updatedPost);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- USER ROUTES ---
app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, bio: true, avatarUrl: true,
        _count: { select: { followers: true, following: true } },
        posts: {
          orderBy: { createdAt: 'desc' },
          include: { 
            likes: true, 
            comments: { include: { author: { select: { id: true, username: true } } } } 
          }
        }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/:id/follow', authenticate, async (req, res) => {
  try {
    const followingId = parseInt(req.params.id);
    const followerId = req.user.id;

    if (followingId === followerId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existingFollow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } }
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      res.json({ followed: false });
    } else {
      await prisma.follow.create({ data: { followerId, followingId } });
      res.json({ followed: true });

      const notif = await prisma.notification.create({
        data: { type: 'FOLLOW', actorId: followerId, userId: followingId },
        include: { actor: { select: { id: true, username: true } } }
      });
      io.to(`user_${followingId}`).emit('new_notification', notif);
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- NOTIFICATION ROUTES ---
app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { 
        actor: { select: { id: true, username: true, avatarUrl: true } },
        post: { select: { id: true, content: true } }
      }
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/notifications/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Fallback to index.html for single page app routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
