import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { stackServerApp } from "@/stack";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.NEXT_PUBLIC_PROJECTID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
    });
}

export async function POST(req: Request) {
    const user = await stackServerApp.getUser();

    if (!user?.id || !user?.primaryEmail) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const uid = user.id;
    const email = user.primaryEmail;

    try {
        let firebaseUser;

        try {
            console.log("🔹 Verificando usuario en Firebase:", { uid, email });
            firebaseUser = await admin.auth().getUser(uid);
        } catch (error: any) {
            if (error.code === "auth/user-not-found") {
                console.log("🆕 Creando usuario en Firebase...");
                firebaseUser = await admin.auth().createUser({ uid, email });
            } else {
                throw error;
            }
        }

        // 🔥 Verificar si el usuario ya tiene una suscripción en Firestore
        const subscriptionRef = admin.firestore().collection("subscriptions").doc(uid);
        let subscriptionData = null;

        try {
            const subscriptionDoc = await subscriptionRef.get();
            if (subscriptionDoc.exists) {
                subscriptionData = subscriptionDoc.data();
            } else {
                // Si no tiene suscripción, crear una inicial
                console.log("🆕 Creando suscripción inicial...");
                await subscriptionRef.set({
                    userId: uid,
                    plan: "free",
                    subscriptionStatus: "inactive",
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    nextBillingDate: null,
                    createdAt: new Date().toISOString(),
                });

                subscriptionData = {
                    userId: uid,
                    plan: "free",
                    subscriptionStatus: "inactive",
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    nextBillingDate: null,
                };
            }
        } catch (error) {
            console.error("🔥 Error obteniendo suscripción:", error);
        }

        // Crear Custom Token para Firebase Auth
        const firebaseToken = await admin.auth().createCustomToken(uid);

        return NextResponse.json({
            user: {
                name: user.displayName,
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                createdAt: firebaseUser.metadata.creationTime,
                lastSignInAt: firebaseUser.metadata.lastSignInTime,
                subscription: subscriptionData,
            },
            token: firebaseToken
        });

    } catch (error) {
        console.error("🔥 Error en autenticación con Firebase:", error);
        return NextResponse.json({ error: "Error generando token" }, { status: 500 });
    }
}