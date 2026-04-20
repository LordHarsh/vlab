'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { GraduationCap, BookOpen, ChevronRight, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { completeOnboarding } from '@/lib/actions/profile'
import type { OnboardingData } from '@/lib/actions/profile'

// ─── Zod schemas ───────────────────────────────────────────────────────────────

const studentSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  registration_no: z.string().min(1, 'Registration number is required'),
  year: z
    .string()
    .min(1, 'Year is required')
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(6)),
  department: z.string().min(1, 'Department is required'),
  class_section: z.string().min(1, 'Class section is required'),
  phone: z.string().optional(),
})

const educatorSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  employee_no: z.string().min(1, 'Employee number is required'),
  department: z.string().min(1, 'Department is required'),
  phone: z.string().optional(),
})

type StudentFormValues = z.infer<typeof studentSchema>
type EducatorFormValues = z.infer<typeof educatorSchema>

// ─── Helper: field wrapper ─────────────────────────────────────────────────────

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium text-[#222222]">
        {label}
        {required && <span className="text-[#ff385c] ml-0.5">*</span>}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Student form ─────────────────────────────────────────────────────────────

function StudentForm({
  onSubmit,
  isPending,
  serverError,
}: {
  onSubmit: (data: StudentFormValues) => void
  isPending: boolean
  serverError: string | null
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StudentFormValues>({ resolver: zodResolver(studentSchema) })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First Name" error={errors.first_name?.message} required>
          <Input
            {...register('first_name')}
            placeholder="Arjun"
            aria-invalid={!!errors.first_name}
          />
        </Field>
        <Field label="Last Name" error={errors.last_name?.message} required>
          <Input
            {...register('last_name')}
            placeholder="Sharma"
            aria-invalid={!!errors.last_name}
          />
        </Field>
      </div>

      <Field
        label="Registration Number"
        error={errors.registration_no?.message}
        required
      >
        <Input
          {...register('registration_no')}
          placeholder="e.g. 21BEC1001"
          aria-invalid={!!errors.registration_no}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Year" error={errors.year?.message} required>
          <Select {...register('year')} aria-invalid={!!errors.year}>
            <option value="">Select year</option>
            {[1, 2, 3, 4, 5, 6].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Class Section"
          error={errors.class_section?.message}
          required
        >
          <Input
            {...register('class_section')}
            placeholder="e.g. A"
            aria-invalid={!!errors.class_section}
          />
        </Field>
      </div>

      <Field label="Department" error={errors.department?.message} required>
        <Input
          {...register('department')}
          placeholder="e.g. Electronics & Communication"
          aria-invalid={!!errors.department}
        />
      </Field>

      <Field label="Phone" error={errors.phone?.message}>
        <Input
          {...register('phone')}
          type="tel"
          placeholder="+91 98765 43210"
        />
      </Field>

      {serverError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {serverError}
        </div>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-[#ff385c] hover:bg-[#e0334f] text-white rounded-lg font-semibold h-11 mt-2"
      >
        {isPending ? 'Saving…' : 'Complete Setup'}
      </Button>
    </form>
  )
}

// ─── Educator form ────────────────────────────────────────────────────────────

function EducatorForm({
  onSubmit,
  isPending,
  serverError,
}: {
  onSubmit: (data: EducatorFormValues) => void
  isPending: boolean
  serverError: string | null
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EducatorFormValues>({ resolver: zodResolver(educatorSchema) })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First Name" error={errors.first_name?.message} required>
          <Input
            {...register('first_name')}
            placeholder="Dr. Priya"
            aria-invalid={!!errors.first_name}
          />
        </Field>
        <Field label="Last Name" error={errors.last_name?.message} required>
          <Input
            {...register('last_name')}
            placeholder="Nair"
            aria-invalid={!!errors.last_name}
          />
        </Field>
      </div>

      <Field
        label="Employee Number"
        error={errors.employee_no?.message}
        required
      >
        <Input
          {...register('employee_no')}
          placeholder="e.g. EMP2024001"
          aria-invalid={!!errors.employee_no}
        />
      </Field>

      <Field label="Department" error={errors.department?.message} required>
        <Input
          {...register('department')}
          placeholder="e.g. Electronics & Communication"
          aria-invalid={!!errors.department}
        />
      </Field>

      <Field label="Phone" error={errors.phone?.message}>
        <Input
          {...register('phone')}
          type="tel"
          placeholder="+91 98765 43210"
        />
      </Field>

      {serverError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {serverError}
        </div>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-[#ff385c] hover:bg-[#e0334f] text-white rounded-lg font-semibold h-11 mt-2"
      >
        {isPending ? 'Saving…' : 'Complete Setup'}
      </Button>
    </form>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [role, setRole] = useState<'student' | 'educator' | null>(null)
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  function handleRoleSelect(selected: 'student' | 'educator') {
    setRole(selected)
    setStep(2)
  }

  function handleStudentSubmit(values: StudentFormValues) {
    if (!role) return
    setServerError(null)
    startTransition(async () => {
      const payload: OnboardingData = {
        role: 'student',
        first_name: values.first_name,
        last_name: values.last_name,
        department: values.department,
        phone: values.phone || undefined,
        registration_no: values.registration_no,
        year: values.year,
        class_section: values.class_section,
      }
      const result = await completeOnboarding(payload)
      if (result.success) {
        router.push('/dashboard')
      } else {
        setServerError(result.error ?? 'Something went wrong.')
      }
    })
  }

  function handleEducatorSubmit(values: EducatorFormValues) {
    if (!role) return
    setServerError(null)
    startTransition(async () => {
      const payload: OnboardingData = {
        role: 'educator',
        first_name: values.first_name,
        last_name: values.last_name,
        department: values.department,
        phone: values.phone || undefined,
        employee_no: values.employee_no,
      }
      const result = await completeOnboarding(payload)
      if (result.success) {
        // Educators go to pending-approval; they cannot access educator tools until approved
        router.push('/pending-approval')
      } else {
        setServerError(result.error ?? 'Something went wrong.')
      }
    })
  }

  return (
    <div className="w-full max-w-lg">
      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-8 justify-center">
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
            step >= 1
              ? 'bg-[#ff385c] text-white'
              : 'bg-[#ebebeb] text-[#6a6a6a]'
          }`}
        >
          1
        </div>
        <div
          className={`h-0.5 w-16 rounded-full transition-colors ${
            step === 2 ? 'bg-[#ff385c]' : 'bg-[#ebebeb]'
          }`}
        />
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
            step === 2
              ? 'bg-[#ff385c] text-white'
              : 'bg-[#ebebeb] text-[#6a6a6a]'
          }`}
        >
          2
        </div>
      </div>

      <div
        className="bg-white rounded-2xl p-8"
        style={{
          boxShadow:
            'rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px',
        }}
      >
        {step === 1 && (
          <>
            <h1 className="text-2xl font-bold text-[#222222] mb-2">
              Welcome to VLab
            </h1>
            <p className="text-[#6a6a6a] mb-8">
              Tell us a bit about yourself to get started.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Student card */}
              <button
                onClick={() => handleRoleSelect('student')}
                className="group rounded-xl border-2 border-[#ebebeb] p-6 text-left hover:border-[#ff385c] hover:bg-[#fff0f3] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff385c]"
              >
                <div className="w-10 h-10 rounded-lg bg-[#f2f2f2] group-hover:bg-[#ffd6de] flex items-center justify-center mb-4 transition-colors">
                  <GraduationCap className="h-5 w-5 text-[#6a6a6a] group-hover:text-[#ff385c] transition-colors" />
                </div>
                <p className="font-semibold text-[#222222] mb-1">Student</p>
                <p className="text-xs text-[#6a6a6a]">
                  Access labs, submit experiments, and track your progress.
                </p>
                <ChevronRight className="mt-3 h-4 w-4 text-[#6a6a6a] group-hover:text-[#ff385c] transition-colors" />
              </button>

              {/* Educator card */}
              <button
                onClick={() => handleRoleSelect('educator')}
                className="group rounded-xl border-2 border-[#ebebeb] p-6 text-left hover:border-[#ff385c] hover:bg-[#fff0f3] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff385c]"
              >
                <div className="w-10 h-10 rounded-lg bg-[#f2f2f2] group-hover:bg-[#ffd6de] flex items-center justify-center mb-4 transition-colors">
                  <BookOpen className="h-5 w-5 text-[#6a6a6a] group-hover:text-[#ff385c] transition-colors" />
                </div>
                <p className="font-semibold text-[#222222] mb-1">Educator</p>
                <p className="text-xs text-[#6a6a6a]">
                  Create classes, manage students, and assign experiments.
                </p>
                <ChevronRight className="mt-3 h-4 w-4 text-[#6a6a6a] group-hover:text-[#ff385c] transition-colors" />
              </button>
            </div>
          </>
        )}

        {step === 2 && role === 'student' && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setStep(1)}
                className="text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors"
              >
                ← Back
              </button>
              <div className="h-4 w-px bg-[#ebebeb]" />
              <span className="flex items-center gap-1.5 text-sm font-medium text-[#ff385c]">
                <GraduationCap className="h-4 w-4" />
                Student
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#222222] mb-1">
              Your details
            </h2>
            <p className="text-[#6a6a6a] text-sm mb-6">
              Fill in your academic information to complete setup.
            </p>
            <StudentForm
              onSubmit={handleStudentSubmit}
              isPending={isPending}
              serverError={serverError}
            />
          </>
        )}

        {step === 2 && role === 'educator' && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setStep(1)}
                className="text-sm text-[#6a6a6a] hover:text-[#222222] transition-colors"
              >
                ← Back
              </button>
              <div className="h-4 w-px bg-[#ebebeb]" />
              <span className="flex items-center gap-1.5 text-sm font-medium text-[#ff385c]">
                <BookOpen className="h-4 w-4" />
                Educator
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#222222] mb-1">
              Your details
            </h2>
            <p className="text-[#6a6a6a] text-sm mb-6">
              Fill in your faculty information to complete setup.
            </p>
            <EducatorForm
              onSubmit={handleEducatorSubmit}
              isPending={isPending}
              serverError={serverError}
            />
          </>
        )}
      </div>
    </div>
  )
}
