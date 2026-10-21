package com.juwel522.myapp

import android.provider.ContactsContract
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap

class FastContactsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String {
        return "FastContacts"
    }

    @ReactMethod
    fun getContactsAsync(promise: Promise) {
        try {
            val contactsList = WritableNativeArray()
            val projection = arrayOf(
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            )

            val cursor = reactApplicationContext.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            )

            cursor?.use {
                val idIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val nameIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (it.moveToNext()) {
                    val contact = WritableNativeMap()
                    contact.putString("id", it.getString(idIndex))
                    contact.putString("name", it.getString(nameIndex) ?: "Unknown")
                    contact.putString("phoneNumber", it.getString(numberIndex) ?: "")
                    contactsList.pushMap(contact)
                }
            }
            promise.resolve(contactsList)
        } catch (e: Exception) {
            promise.reject("CONTACTS_ERROR", e)
        }
    }
}