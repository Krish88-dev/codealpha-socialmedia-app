const API_URL = 'http://localhost:3000/api';

const api = {
    getToken() {
        return localStorage.getItem('token');
    },

    setToken(token) {
        localStorage.setItem('token', token);
    },

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    },

    setUser(user) {
        localStorage.setItem('user', JSON.stringify(user));
    },

    getUser() {
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Something went wrong');
        }
        return data;
    },

    auth: {
        login: (username, password) => api.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        }),
        register: (username, password, bio) => api.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, bio })
        }),
        me: () => api.request('/auth/me')
    },

    posts: {
        getAll: () => api.request('/posts'),
        create: async (data) => {
            let body, headers;
            if (data instanceof FormData) {
                body = data;
                headers = { 'Authorization': `Bearer ${api.getToken()}` };
            } else {
                body = JSON.stringify({ content: data });
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.getToken()}` };
            }
            return fetch(`${API_URL}/posts`, {
                method: 'POST',
                headers,
                body
            }).then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Something went wrong');
                return data;
            });
        },
        like: (postId) => api.request(`/posts/${postId}/like`, { method: 'POST' }),
        comment: (postId, content) => api.request(`/posts/${postId}/comments`, {
            method: 'POST',
            body: JSON.stringify({ content })
        })
    },

    users: {
        getProfile: (userId) => api.request(`/users/${userId}`),
        toggleFollow: (userId) => api.request(`/users/${userId}/follow`, { method: 'POST' })
    },

    notifications: {
        async fetch() {
            const res = await fetch(`${API_URL}/notifications`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        },
        async markRead() {
            const res = await fetch(`${API_URL}/notifications/read`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        }
    }
};
