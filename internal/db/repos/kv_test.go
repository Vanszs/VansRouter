package repos

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestKVRepo_SetGetDelete(t *testing.T) {
	db, cleanup := openReposTestDB(t)
	defer cleanup()

	kv := NewKVRepo(db)

	// Set and get
	require.NoError(t, kv.Set("test", "key1", "value1"))
	val, found, err := kv.Get("test", "key1")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "value1", val)

	// Get non-existent
	_, found, err = kv.Get("test", "nope")
	require.NoError(t, err)
	require.False(t, found)

	// Upsert
	require.NoError(t, kv.Set("test", "key1", "updated"))
	val, found, err = kv.Get("test", "key1")
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "updated", val)

	// Delete
	require.NoError(t, kv.Delete("test", "key1"))
	_, found, err = kv.Get("test", "key1")
	require.NoError(t, err)
	require.False(t, found)
}

func TestKVRepo_GetAll(t *testing.T) {
	db, cleanup := openReposTestDB(t)
	defer cleanup()

	kv := NewKVRepo(db)

	require.NoError(t, kv.Set("scope1", "a", "1"))
	require.NoError(t, kv.Set("scope1", "b", "2"))
	require.NoError(t, kv.Set("scope2", "c", "3"))

	all, err := kv.GetAll("scope1")
	require.NoError(t, err)
	require.Equal(t, map[string]string{"a": "1", "b": "2"}, all)
}

func TestKVRepo_DeleteScope(t *testing.T) {
	db, cleanup := openReposTestDB(t)
	defer cleanup()

	kv := NewKVRepo(db)

	require.NoError(t, kv.Set("scope1", "a", "1"))
	require.NoError(t, kv.Set("scope1", "b", "2"))

	require.NoError(t, kv.DeleteScope("scope1"))

	all, err := kv.GetAll("scope1")
	require.NoError(t, err)
	require.Empty(t, all)
}

func TestKVRepo_SetJSONGetJSON(t *testing.T) {
	db, cleanup := openReposTestDB(t)
	defer cleanup()

	kv := NewKVRepo(db)

	data := map[string]string{"foo": "bar"}
	require.NoError(t, kv.SetJSON("test", "json", data))

	var result map[string]string
	found, err := kv.GetJSON("test", "json", &result)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, data, result)
}
