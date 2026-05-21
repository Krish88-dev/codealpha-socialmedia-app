const app = {
    isLoginMode: true,
    currentView: 'auth-view',
    currentProfileId: null,
    socket: null,

    init() {
        if (api.getToken()) {
            this.setupSocket();
            this.showFeed();
            this.updateSidebarUser();
        } else {
            this.showAuth();
        }
    },

    setupSocket() {
        if (this.socket) return;
        this.socket = io('http://localhost:3000');
        this.socket.on('connect', () => {
            const user = api.getUser();
            if (user) {
                this.socket.emit('join', user.id);
            }
        });
        
        this.socket.on('new_post', (post) => {
            if (this.currentView === 'feed-view') {
                const container = document.getElementById('posts-container');
                // Remove skeleton if present
                const skeletons = container.querySelectorAll('.post-skeleton');
                if (skeletons.length > 0) container.innerHTML = '';
                
                const postHtml = this.generatePostHtml(post);
                container.insertAdjacentHTML('afterbegin', postHtml);
                container.firstElementChild.classList.add('new-post-animation');
            }
        });

        this.socket.on('post_updated', (updatedPost) => {
            ['feed', 'profile'].forEach(context => {
                const postEl = document.getElementById(`${context}-post-${updatedPost.id}`);
                if (postEl) {
                    const newHtml = this.generatePostHtml(updatedPost, null, context);
                    postEl.outerHTML = newHtml;
                }
            });
        });

        this.socket.on('new_notification', (notif) => {
            this.showToast(`New ${notif.type.toLowerCase()} from ${notif.actor.username}`, 'success');
            const badge = document.getElementById('notification-badge');
            badge.textContent = parseInt(badge.textContent || '0') + 1;
            badge.classList.remove('hidden');
            if (this.currentView === 'notifications-view') {
                this.loadNotifications();
            }
        });
    },

    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
    },

    switchView(viewId) {
        if (viewId === 'auth-view') {
            document.getElementById('auth-view').classList.remove('hidden');
            document.getElementById('main-app').classList.add('hidden');
        } else {
            document.getElementById('auth-view').classList.add('hidden');
            document.getElementById('main-app').classList.remove('hidden');
            
            ['feed-view', 'profile-view', 'notifications-view'].forEach(id => {
                document.getElementById(id).classList.add('hidden');
            });
            document.getElementById(viewId).classList.remove('hidden');

            // Update active nav state
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            if (viewId === 'feed-view') document.getElementById('nav-home').classList.add('active');
            if (viewId === 'profile-view') document.getElementById('nav-profile').classList.add('active');
            if (viewId === 'notifications-view') document.getElementById('nav-notifications').classList.add('active');
        }
        this.currentView = viewId;
    },

    showAuth() {
        this.switchView('auth-view');
    },

    async showFeed() {
        if (!api.getToken()) return this.showAuth();
        this.switchView('feed-view');
        await this.loadPosts();
    },

    async showProfile(userId) {
        if (!api.getToken()) return this.showAuth();
        this.switchView('profile-view');
        this.currentProfileId = userId;
        await this.loadProfile(userId);
    },

    showMyProfile() {
        const user = api.getUser();
        if (user) this.showProfile(user.id);
    },

    async showNotifications() {
        if (!api.getToken()) return this.showAuth();
        this.switchView('notifications-view');
        await this.loadNotifications();
    },

    toggleAuthMode() {
        this.isLoginMode = !this.isLoginMode;
        document.getElementById('auth-title').textContent = this.isLoginMode ? 'Welcome Back' : 'Create Account';
        document.getElementById('bio-group').classList.toggle('hidden', this.isLoginMode);
        document.getElementById('auth-submit').textContent = this.isLoginMode ? 'Login' : 'Sign Up';
        document.getElementById('auth-switch-text').textContent = this.isLoginMode ? "Don't have an account? Sign up" : "Already have an account? Login";
    },

    async handleAuth(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const bio = document.getElementById('bio').value;

        try {
            let res;
            if (this.isLoginMode) {
                res = await api.auth.login(username, password);
            } else {
                res = await api.auth.register(username, password, bio);
            }
            api.setToken(res.token);
            api.setUser(res.user);
            this.setupSocket();
            this.updateSidebarUser();
            this.showToast('Successfully authenticated!');
            this.showFeed();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    logout() {
        api.logout();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.showAuth();
        this.showToast('Logged out successfully');
    },

    updateSidebarUser() {
        const user = api.getUser();
        if (user) {
            document.getElementById('sidebar-user').innerHTML = `
                <div class="avatar" style="width: 40px; height: 40px;">${user.username.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <div style="font-weight: 700;">${user.username}</div>
                </div>
            `;
            document.getElementById('feed-avatar').textContent = user.username.charAt(0).toUpperCase();
        }
    },

    renderSkeletons(containerId) {
        const skeletonHtml = `
            <div class="post-skeleton">
                <div class="skeleton skeleton-avatar"></div>
                <div style="flex: 1;">
                    <div class="skeleton skeleton-text short"></div>
                    <div class="skeleton skeleton-text medium"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text"></div>
                </div>
            </div>
        `;
        document.getElementById(containerId).innerHTML = skeletonHtml.repeat(3);
    },

    async loadPosts() {
        this.renderSkeletons('posts-container');
        try {
            const posts = await api.posts.getAll();
            this.renderPosts(posts, 'posts-container', null, 'feed');
        } catch (error) {
            this.showToast('Failed to load posts', 'error');
            document.getElementById('posts-container').innerHTML = '';
        }
    },

    async loadNotifications() {
        const container = document.getElementById('notifications-container');
        container.innerHTML = '<div class="post-skeleton"><div class="skeleton skeleton-text"></div></div>';
        try {
            const notifications = await api.notifications.fetch();
            if (notifications.length === 0) {
                container.innerHTML = '<div class="glass-panel" style="text-align:center; padding: 2rem;">No notifications yet.</div>';
                return;
            }
            container.innerHTML = notifications.map(n => this.generateNotificationHtml(n)).join('');
            
            // Update badge count based on unread
            const unreadCount = notifications.filter(n => !n.isRead).length;
            const badge = document.getElementById('notification-badge');
            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        } catch (error) {
            this.showToast('Failed to load notifications', 'error');
            container.innerHTML = '';
        }
    },

    async markNotificationsRead() {
        try {
            await api.notifications.markRead();
            document.getElementById('notification-badge').classList.add('hidden');
            document.getElementById('notification-badge').textContent = '0';
            this.showToast('Notifications marked as read');
            this.loadNotifications();
        } catch (error) {
            this.showToast('Failed to mark as read', 'error');
        }
    },

    generateNotificationHtml(notif) {
        let iconHtml = '';
        let textHtml = '';
        let onClick = '';
        
        if (notif.type === 'LIKE') {
            iconHtml = '<div class="notification-icon like">❤️</div>';
            textHtml = `<strong>${notif.actor.username}</strong> liked your post.`;
            onClick = `onclick="app.showFeed()"`;
        } else if (notif.type === 'COMMENT') {
            iconHtml = '<div class="notification-icon comment">💬</div>';
            textHtml = `<strong>${notif.actor.username}</strong> commented on your post.`;
            onClick = `onclick="app.showFeed()"`;
        } else if (notif.type === 'FOLLOW') {
            iconHtml = '<div class="notification-icon follow">👥</div>';
            textHtml = `<strong>${notif.actor.username}</strong> started following you.`;
            onClick = `onclick="app.showProfile(${notif.actor.id})"`;
        }

        const date = new Date(notif.createdAt).toLocaleDateString();
        
        return `
            <div class="notification-card ${notif.isRead ? '' : 'unread'}" ${onClick}>
                ${iconHtml}
                <div class="notification-content">
                    ${textHtml}
                    ${notif.post ? `<div style="font-size: 0.9rem; color: #94a3b8; margin-top: 4px;">"${notif.post.content}"</div>` : ''}
                    <div class="notification-time">${date}</div>
                </div>
            </div>
        `;
    },

    handleMediaSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const container = document.getElementById('media-preview-container');
        // Clear existing preview if any
        Array.from(container.children).forEach(child => {
            if (!child.classList.contains('btn-close')) child.remove();
        });

        const previewEl = document.createElement(file.type.startsWith('video') ? 'video' : 'img');
        previewEl.src = URL.createObjectURL(file);
        if (file.type.startsWith('video')) previewEl.controls = true;
        
        container.insertBefore(previewEl, container.firstChild);
        container.classList.remove('hidden');
    },

    clearMediaPreview() {
        const input = document.getElementById('media-upload');
        input.value = '';
        
        const container = document.getElementById('media-preview-container');
        Array.from(container.children).forEach(child => {
            if (!child.classList.contains('btn-close')) child.remove();
        });
        container.classList.add('hidden');
    },

    async createPost() {
        const input = document.getElementById('new-post-content');
        const fileInput = document.getElementById('media-upload');
        const content = input.value.trim();
        const file = fileInput.files[0];

        if (!content && !file) return;

        let postData;
        if (file) {
            postData = new FormData();
            postData.append('content', content);
            postData.append('media', file);
        } else {
            postData = content;
        }

        try {
            await api.posts.create(postData);
            input.value = '';
            this.clearMediaPreview();
            // Socket handles UI update
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    async toggleLike(postId) {
        try {
            await api.posts.like(postId);
            // Socket handles UI update
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    toggleComments(postId, context) {
        const el = document.getElementById(`${context}-comments-${postId}`);
        if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
    },

    async addComment(postId, context) {
        const input = document.getElementById(`${context}-comment-input-${postId}`);
        const content = input.value.trim();
        if (!content) return;

        try {
            await api.posts.comment(postId, content);
            // Socket handles UI update
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    async loadProfile(userId) {
        this.renderSkeletons('profile-posts-container');
        try {
            const profile = await api.users.getProfile(userId);
            document.getElementById('profile-avatar').textContent = profile.username.charAt(0).toUpperCase();
            document.getElementById('profile-name').textContent = profile.username;
            document.getElementById('profile-bio').textContent = profile.bio || '';
            document.getElementById('stat-posts').textContent = profile.posts.length;
            document.getElementById('stat-followers').textContent = profile._count.followers;
            document.getElementById('stat-following').textContent = profile._count.following;

            const currentUser = api.getUser();
            const followBtn = document.getElementById('profile-follow-btn');
            if (currentUser && currentUser.id === profile.id) {
                followBtn.classList.add('hidden');
            } else {
                followBtn.classList.remove('hidden');
                followBtn.textContent = 'Follow / Unfollow';
            }

            this.renderPosts(profile.posts, 'profile-posts-container', profile, 'profile');
        } catch (error) {
            this.showToast('Failed to load profile', 'error');
            document.getElementById('profile-posts-container').innerHTML = '';
        }
    },

    async toggleFollow() {
        if (!this.currentProfileId) return;
        try {
            const res = await api.users.toggleFollow(this.currentProfileId);
            this.showToast(res.followed ? 'Followed!' : 'Unfollowed!');
            this.loadProfile(this.currentProfileId);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    generatePostHtml(post, authorOverride = null, context = 'feed') {
        const currentUser = api.getUser();
        const author = authorOverride || post.author;
        const isLiked = post.likes.some(l => currentUser && l.userId === currentUser.id);
        const date = new Date(post.createdAt).toLocaleDateString();

        const commentsHtml = (post.comments || []).map(c => `
            <div class="comment">
                <div class="avatar">${c.author.username.charAt(0).toUpperCase()}</div>
                <div class="comment-content">
                    <div class="comment-author">${c.author.username}</div>
                    <div class="comment-text">${c.content}</div>
                </div>
            </div>
        `).join('');

        const existingComments = document.getElementById(`${context}-comments-${post.id}`);
        const displayStyle = existingComments ? existingComments.style.display : 'none';

        let mediaHtml = '';
        if (post.mediaUrl) {
            if (post.mediaType === 'video') {
                mediaHtml = `<div class="post-media"><video src="${post.mediaUrl}" controls></video></div>`;
            } else {
                mediaHtml = `<div class="post-media"><img src="${post.mediaUrl}" alt="Post media"></div>`;
            }
        }

        return `
            <div class="post-card" id="${context}-post-${post.id}">
                <div class="post-header">
                    <div class="avatar">${author.username.charAt(0).toUpperCase()}</div>
                    <div class="post-meta">
                        <div class="author-name" onclick="app.showProfile(${author.id})">${author.username}</div>
                        <div class="post-date">${date}</div>
                    </div>
                </div>
                <div class="post-content">${post.content}</div>
                ${mediaHtml}
                <div class="post-actions">
                    <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="app.toggleLike(${post.id})">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        ${post.likes.length}
                    </button>
                    <button class="action-btn" onclick="app.toggleComments(${post.id}, '${context}')">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                        ${(post.comments || []).length}
                    </button>
                </div>
                <div class="comments-section" id="${context}-comments-${post.id}" style="display: ${displayStyle};">
                    ${commentsHtml}
                    <div class="add-comment">
                        <input type="text" id="${context}-comment-input-${post.id}" placeholder="Post your reply" onkeypress="if(event.key === 'Enter') app.addComment(${post.id}, '${context}')">
                        <button class="btn btn-primary" onclick="app.addComment(${post.id}, '${context}')">Reply</button>
                    </div>
                </div>
            </div>
        `;
    },

    renderPosts(posts, containerId, authorOverride = null, context = 'feed') {
        const container = document.getElementById(containerId);
        container.innerHTML = posts.map(post => this.generatePostHtml(post, authorOverride, context)).join('');
    }
};

window.onload = () => app.init();
