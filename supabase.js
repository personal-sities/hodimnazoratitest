// ============================================================
//  AloqaPro Local PostgreSQL Database Client
//  Supabase butunlay o'chirilgan: Barcha so'rovlar to'g'ridan-to'g'ri
//  serverdagi PostgreSQL va ichki API (/api/db/*) ga yo'naltiriladi.
// ============================================================

(function() {
  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this._select = '*';
      this._filters = [];
      this._order = null;
      this._limit = null;
      this._offset = null;
      this._isSingle = false;
      this._isMaybeSingle = false;
      this._action = 'SELECT';
      this._payload = null;
      this._onConflict = null;
    }

    select(cols = '*') {
      this._select = cols;
      return this;
    }

    eq(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=eq.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    neq(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=neq.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    gte(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=gte.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    lte(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=lte.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    gt(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=gt.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    lt(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=lt.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    like(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=like.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    ilike(col, val) {
      this._filters.push(`${encodeURIComponent(col)}=ilike.${encodeURIComponent(val ?? '')}`);
      return this;
    }

    is(col, val) {
      if (val === null) {
        this._filters.push(`${encodeURIComponent(col)}=is.null`);
      } else {
        this._filters.push(`${encodeURIComponent(col)}=eq.${encodeURIComponent(val)}`);
      }
      return this;
    }

    order(col, options = {}) {
      const dir = (options && options.ascending === false) ? 'desc' : 'asc';
      this._order = `${encodeURIComponent(col)}.${dir}`;
      return this;
    }

    limit(n) {
      this._limit = n;
      return this;
    }

    range(from, to) {
      this._offset = from;
      this._limit = (to - from + 1);
      return this;
    }

    single() {
      this._isSingle = true;
      this._limit = 1;
      return this;
    }

    maybeSingle() {
      this._isMaybeSingle = true;
      this._limit = 1;
      return this;
    }

    insert(data) {
      this._action = 'INSERT';
      this._payload = data;
      return this;
    }

    upsert(data, options = {}) {
      this._action = 'UPSERT';
      this._payload = data;
      if (options && options.onConflict) {
        this._onConflict = options.onConflict;
      }
      return this;
    }

    update(data) {
      this._action = 'UPDATE';
      this._payload = data;
      return this;
    }

    delete() {
      this._action = 'DELETE';
      return this;
    }

    async then(resolve, reject) {
      try {
        const result = await this.execute();
        resolve(result);
      } catch (err) {
        if (reject) reject(err);
        else resolve({ data: null, error: err });
      }
    }

    async execute() {
      const baseUrl = '/api/db/' + this.table;
      const params = [...this._filters];

      if (this._select && this._action === 'SELECT') {
        params.push('select=' + encodeURIComponent(this._select));
      }
      if (this._order) {
        params.push('order=' + this._order);
      }
      if (this._limit) {
        params.push('limit=' + this._limit);
      }
      if (this._offset) {
        params.push('offset=' + this._offset);
      }
      if (this._onConflict) {
        params.push('on_conflict=' + encodeURIComponent(this._onConflict));
      }

      const queryString = params.length > 0 ? ('?' + params.join('&')) : '';
      const url = baseUrl + queryString;

      let method = 'GET';
      let body = null;
      if (this._action === 'INSERT' || this._action === 'UPSERT') {
        method = 'POST';
        body = JSON.stringify(this._payload);
      } else if (this._action === 'UPDATE') {
        method = 'PATCH';
        body = JSON.stringify(this._payload);
      } else if (this._action === 'DELETE') {
        method = 'DELETE';
      }

      const headers = { 'Content-Type': 'application/json' };
      const res = await fetch(url, {
        method,
        headers,
        body
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { data: null, error: { message: errJson.error || ('HTTP xatolik: ' + res.status) } };
      }

      const json = await res.json().catch(() => ({}));
      let data = json.data !== undefined ? json.data : json;

      if (this._isSingle) {
        data = Array.isArray(data) ? (data[0] || null) : data;
        if (!data) return { data: null, error: { message: 'Ma\'lumot topilmadi' } };
      } else if (this._isMaybeSingle) {
        data = Array.isArray(data) ? (data[0] || null) : data;
      }

      return { data, error: null };
    }
  }

  const localClient = {
    from(table) {
      return new QueryBuilder(table);
    },

    async rpc(funcName, params = {}) {
      try {
        const res = await fetch('/api/rpc/' + encodeURIComponent(funcName), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params)
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          return { data: null, error: { message: errJson.error || 'RPC xatosi' } };
        }
        const json = await res.json().catch(() => ({}));
        return { data: json.data !== undefined ? json.data : json, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },

    auth: {
      async signInWithPassword({ email, password }) {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) {
            return { data: null, error: { message: json.error || 'Login yoki parol noto\'g\'ri' } };
          }
          const user = json.user;
          const session = {
            access_token: json.token || ('local_token_' + Date.now()),
            user
          };
          try {
            localStorage.setItem('aloqa_u', JSON.stringify(user));
            localStorage.setItem('aloqa_token', session.access_token);
          } catch (_) {}
          return { data: { user, session }, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message || 'Serverga ulanib bo\'lmadi' } };
        }
      },

      async signUp({ email, password, options = {} }) {
        try {
          const res = await fetch('/api/functions/v1/create-employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password,
              name: options?.data?.name || email.split('@')[0],
              role: options?.data?.role || 'employee',
              operator_number: options?.data?.operator_number
            })
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) {
            return { data: null, error: { message: json.error || 'Xodim yaratilmadi' } };
          }
          return { data: { user: json.employee, session: null }, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },

      async signOut() {
        try {
          localStorage.removeItem('aloqa_u');
          localStorage.removeItem('aloqa_token');
        } catch (_) {}
        return { error: null };
      },

      async getSession() {
        try {
          const uStr = localStorage.getItem('aloqa_u');
          const token = localStorage.getItem('aloqa_token') || 'local_token';
          if (uStr) {
            const user = JSON.parse(uStr);
            return { data: { session: { user, access_token: token } }, error: null };
          }
        } catch (_) {}
        return { data: { session: null }, error: null };
      },

      onAuthStateChange(callback) {
        setTimeout(async () => {
          const sess = await this.getSession();
          if (sess?.data?.session) {
            callback('SIGNED_IN', sess.data.session);
          }
        }, 10);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },

    channel(name) {
      return {
        on() { return this; },
        subscribe(cb) { if (cb) setTimeout(() => cb('SUBSCRIBED'), 10); return this; },
        unsubscribe() { return this; }
      };
    },

    removeChannel() {}
  };

  window.supabase = {
    createClient() {
      return localClient;
    }
  };
})();