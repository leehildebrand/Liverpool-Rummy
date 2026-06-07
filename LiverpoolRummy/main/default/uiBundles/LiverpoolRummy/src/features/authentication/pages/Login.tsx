import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { z } from "zod";
import { CenteredPageLayout } from "../layout/centered-page-layout";
import { AuthForm } from "../forms/auth-form";
import { useAppForm } from "../hooks/form";
import { createDataSDK } from "@salesforce/sdk-data";
import { ROUTES } from "../authenticationConfig";
import { emailSchema } from "../authHelpers";
import { getErrorMessage } from "../utils/helpers";

const loginSchema = z.object({
	email: emailSchema,
	password: z.string().min(1, "Password is required"),
});

const LOGIN_CONTACT_QUERY = `
	query LoginContact($email: String) {
		uiapi {
			query {
				Contact(where: { Email: { eq: $email } }, first: 1) {
					edges {
						node {
							Id
							Password__c @optional { value }
						}
					}
				}
			}
		}
	}
`;

function throwOnGraphQLErrors(response: any): void {
	if (response?.errors?.length) {
		throw new Error(response.errors.map((e: any) => e.message).join("; "));
	}
}

export default function Login() {
	const navigate = useNavigate();
	const [submitError, setSubmitError] = useState<string | null>(null);

	const form = useAppForm({
		defaultValues: { email: "", password: "" },
		validators: { onChange: loginSchema, onSubmit: loginSchema },
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			try {
				const sdk = await createDataSDK();
				const normalizedEmail = value.email.trim().toLowerCase();
				const response: any = await sdk.graphql?.(LOGIN_CONTACT_QUERY, {
					email: normalizedEmail,
				});

				throwOnGraphQLErrors(response);

				const contactNode = response?.data?.uiapi?.query?.Contact?.edges?.[0]?.node;
				if (!contactNode) {
					setSubmitError("User not found.");
					return;
				}

				const savedPassword = contactNode?.Password__c?.value ?? "";
				if (savedPassword !== value.password) {
					setSubmitError("Invalid password");
					return;
				}

				navigate("/", { replace: true });
			} catch (err) {
				setSubmitError(getErrorMessage(err, "Login failed"));
			}
		},
		onSubmitInvalid: () => {},
	});

	return (
		<CenteredPageLayout title={ROUTES.LOGIN.TITLE}>
			<form.AppForm>
				<AuthForm
					title="Login"
					description="Enter your email below to login to your account"
					error={submitError}
					submit={{ text: "Login", loadingText: "Logging in…" }}
					footer={{
						text: "Don't have an account?",
						link: ROUTES.REGISTER.PATH,
						linkText: "Sign up",
					}}
				>
					<form.AppField name="email">
						{(field) => <field.EmailField label="Email" />}
					</form.AppField>
					<form.AppField name="password">
						{(field) => (
							<field.PasswordField
								label="Password"
								labelAction={
									<Link
										to={ROUTES.FORGOT_PASSWORD.PATH}
										className="text-sm underline-offset-4 hover:underline"
									>
										Forgot your password?
									</Link>
								}
							/>
						)}
					</form.AppField>
				</AuthForm>
			</form.AppForm>
		</CenteredPageLayout>
	);
}
