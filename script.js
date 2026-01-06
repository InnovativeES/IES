/* ==========================================
   INNOVATIVE ENGINEERING SOLUTIONS
   JavaScript Functionality
   ========================================== */

document.addEventListener('DOMContentLoaded', function () {
    // Initialize all modules
    initNavigation();
    initSmoothScroll();
    initStatsCounter();
    initScrollAnimations();
    initContactForm();
    initNavbarScroll();
    initPortfolioFilter();
});

/* ==========================================
   NAVIGATION
   ========================================== */
function initNavigation() {
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('.nav-link');

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function () {
            this.classList.toggle('active');
            navMenu.classList.toggle('active');
        });

        // Close menu when clicking a link
        navLinks.forEach(link => {
            link.addEventListener('click', function () {
                navToggle.classList.remove('active');
                navMenu.classList.remove('active');
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', function (e) {
            if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) {
                navToggle.classList.remove('active');
                navMenu.classList.remove('active');
            }
        });
    }
}

/* ==========================================
   NAVBAR SCROLL EFFECT
   ========================================== */
function initNavbarScroll() {
    const navbar = document.getElementById('navbar');

    if (navbar) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }
}

/* ==========================================
   SMOOTH SCROLLING
   ========================================== */
function initSmoothScroll() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');

            if (href === '#') return;

            e.preventDefault();

            const target = document.querySelector(href);
            if (target) {
                const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 80;
                const targetPosition = target.getBoundingClientRect().top + window.scrollY - navbarHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

/* ==========================================
   ANIMATED STATS COUNTER
   ========================================== */
function initStatsCounter() {
    const stats = document.querySelectorAll('.stat-number[data-target]');

    if (stats.length === 0) return;

    const animateCounter = (element) => {
        const target = parseInt(element.getAttribute('data-target'));
        const duration = 2000; // 2 seconds
        const step = target / (duration / 16); // 60fps
        let current = 0;

        const updateCounter = () => {
            current += step;
            if (current < target) {
                element.textContent = Math.floor(current);
                requestAnimationFrame(updateCounter);
            } else {
                element.textContent = target;
            }
        };

        updateCounter();
    };

    // Use Intersection Observer to trigger animation when visible
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.5,
        rootMargin: '0px'
    });

    stats.forEach(stat => observer.observe(stat));
}

/* ==========================================
   SCROLL ANIMATIONS
   ========================================== */
function initScrollAnimations() {
    // Add animation class to elements
    const animatableElements = document.querySelectorAll(
        '.service-card, .feature-item, .infra-card, .portfolio-item, .gallery-item, ' +
        '.about-content, .about-image, .contact-info, .contact-form-wrapper, ' +
        '.process-step'
    );

    animatableElements.forEach(el => {
        el.classList.add('animate-on-scroll');
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Add staggered delay for grid items
                setTimeout(() => {
                    entry.target.classList.add('animated');
                }, index * 50);
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animatableElements.forEach(el => observer.observe(el));
}

/* ==========================================
   CONTACT FORM
   ========================================== */
function initContactForm() {
    const form = document.getElementById('contactForm');

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();

            // Get form data for validation
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            // Validate form
            if (!validateForm(data)) {
                return;
            }

            // Show loading state
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<span class="loading">Sending...</span>';
            submitBtn.disabled = true;

            // Send email using EmailJS
            // Service ID: service_nmryl5m
            // Template ID: template_hmky5aq
            emailjs.sendForm('service_nmryl5m', 'template_hmky5aq', form)
                .then(function () {
                    // Success message
                    showNotification('Thank you! Your inquiry has been sent successfully.', 'success');
                    form.reset();
                }, function (error) {
                    // Error message
                    console.error('EmailJS Error:', error);
                    showNotification('Failed to send message. Please try again or call us directly.', 'error');
                })
                .finally(function () {
                    // Restore button
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                });
        });
    }
}

function validateForm(data) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[\d\s\-+()]{10,}$/;

    if (!data.name || data.name.trim().length < 2) {
        showNotification('Please enter a valid name.', 'error');
        return false;
    }

    if (!emailRegex.test(data.email)) {
        showNotification('Please enter a valid email address.', 'error');
        return false;
    }

    if (!phoneRegex.test(data.phone)) {
        showNotification('Please enter a valid phone number.', 'error');
        return false;
    }

    if (!data.service) {
        showNotification('Please select a service.', 'error');
        return false;
    }

    if (!data.message || data.message.trim().length < 10) {
        showNotification('Please enter a detailed message (at least 10 characters).', 'error');
        return false;
    }

    return true;
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existing = document.querySelector('.notification');
    if (existing) {
        existing.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close">&times;</button>
    `;

    // Add styles if not already present
    if (!document.querySelector('#notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-styles';
        styles.textContent = `
            .notification {
                position: fixed;
                top: 100px;
                right: 20px;
                max-width: 400px;
                padding: 16px 20px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 14px;
                font-weight: 500;
                z-index: 9999;
                animation: slideIn 0.3s ease-out;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            }
            .notification-success {
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
            }
            .notification-error {
                background: linear-gradient(135deg, #ef4444, #dc2626);
                color: white;
            }
            .notification-info {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: white;
            }
            .notification-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .notification-close:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(styles);
    }

    document.body.appendChild(notification);

    // Close button handler
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    });

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

/* ==========================================
   ACTIVE NAV LINK HIGHLIGHTING
   ========================================== */
function initActiveNavHighlight() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    window.addEventListener('scroll', () => {
        let current = '';
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 80;

        sections.forEach(section => {
            const sectionTop = section.offsetTop - navbarHeight - 100;
            const sectionHeight = section.clientHeight;

            if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
}

// Initialize active nav highlighting
document.addEventListener('DOMContentLoaded', initActiveNavHighlight);

/* ==========================================
   PARALLAX EFFECT (HERO)
   ========================================== */
function initParallax() {
    const hero = document.querySelector('.hero');
    const heroOverlay = document.querySelector('.hero-overlay');

    if (hero && heroOverlay) {
        window.addEventListener('scroll', () => {
            const scrolled = window.scrollY;
            if (scrolled < window.innerHeight) {
                heroOverlay.style.transform = `translateY(${scrolled * 0.3}px)`;
            }
        });
    }
}

// Initialize parallax
document.addEventListener('DOMContentLoaded', initParallax);

/* ==========================================
   PRELOADER (Optional)
   ========================================== */
window.addEventListener('load', function () {
    document.body.classList.add('loaded');
});

/* ==========================================
   PORTFOLIO FILTER
   ========================================== */
function initPortfolioFilter() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    const galleryItems = document.querySelectorAll('.gallery-item');

    if (filterBtns.length === 0 || galleryItems.length === 0) return;

    filterBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            const filter = this.getAttribute('data-filter');

            // Filter items with animation
            galleryItems.forEach((item, index) => {
                const category = item.getAttribute('data-category');

                if (filter === 'all' || category === filter) {
                    // Show item with staggered animation
                    setTimeout(() => {
                        item.classList.remove('hidden');
                        item.style.opacity = '0';
                        item.style.transform = 'scale(0.8)';

                        requestAnimationFrame(() => {
                            item.style.transition = 'all 0.3s ease-out';
                            item.style.opacity = '1';
                            item.style.transform = 'scale(1)';
                        });
                    }, index * 30);
                } else {
                    // Hide item
                    item.style.transition = 'all 0.2s ease-out';
                    item.style.opacity = '0';
                    item.style.transform = 'scale(0.8)';

                    setTimeout(() => {
                        item.classList.add('hidden');
                    }, 200);
                }
            });
        });
    });
}

// Initialize portfolio filters and contact form
document.addEventListener('DOMContentLoaded', function () {
    initPortfolioFilter();
    initContactForm();
});
