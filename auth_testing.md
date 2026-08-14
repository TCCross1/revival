# Auth Testing Playbook (Emergent Google Auth)

Session-based Google OAuth. Sessions stored in `user_sessions`, users in `users`.

## Create test user & session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({user_id: userId, email: 'test.user.'+Date.now()+'@example.com', name: 'Test User', picture: '', created_at: new Date().toISOString()});
db.user_sessions.insertOne({user_id: userId, session_token: sessionToken, expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString(), created_at: new Date().toISOString()});
print('Session token: ' + sessionToken);
"
```

## Backend test
```
curl -X GET "$URL/api/auth/me" -H "Authorization: Bearer <TOKEN>"
curl -X GET "$URL/api/clients" -H "Authorization: Bearer <TOKEN>"
```

## Browser test
Set cookie `session_token` (httpOnly, secure, sameSite None) for the domain, then goto the app root.
